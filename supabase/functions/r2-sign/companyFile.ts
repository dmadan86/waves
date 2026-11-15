/**
 * Company Files bytes through r2-sign. Same bucket ('company-entry-images'), ledger (storage_objects) and quota as company
 * photos; the key is `cf/<groupId>/<fileId>` and the subject is the file id. Who may write is decided in the database
 * (owner or manager of the group, quota, type, size) and who may read by the file row's visibility, asked as the caller.
 * A file is removed through its delete RPC, which frees the ledger row; the orphan sweep then deletes the R2 object.
 */

import { HttpError, json, type SupabaseClient } from '../_shared/auth.ts';
import { RESTRICTED_URL_TTL_SECONDS, type LogicalBucket } from '../_shared/r2.ts';

export const MAX_COMPANY_FILE_BYTES = 25 * 1024 * 1024;
/** Mirrors waves_company_file_storage_write. No html or svg: a file is only ever downloaded, never rendered. */
export const COMPANY_FILE_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^cf/(${ID})/(${ID})$`, 'i');

/** The slice of r2-sign's dependencies this module needs. */
interface Deps {
  objectUrl(bucket: LogicalBucket, path: string): string;
  r2(): {
    client: {
      sign(request: Request, options?: unknown): Promise<{ url: string }>;
      fetch(input: string, init?: { method: string }): Promise<Response>;
    };
  };
}

export function companyFileDbError(message: string): HttpError {
  if (message.includes('STORAGE_CAP'))
    return new HttpError(402, 'STORAGE_CAP', 'Your company storage is full; add a storage pack.');
  if (message.includes('TOO_MANY_PENDING'))
    return new HttpError(429, 'TOO_MANY_PENDING', 'Too many uploads in flight; try again shortly.');
  if (message.includes('NOT_UPLOADER'))
    return new HttpError(403, 'NOT_UPLOADER', 'Only the person who added this file can change it');
  if (message.includes('NOT_ALLOWED'))
    return new HttpError(403, 'NOT_ALLOWED', 'Only owners and managers can add files');
  if (message.includes('IMMUTABLE_OBJECT'))
    return new HttpError(409, 'IMMUTABLE_OBJECT', 'That file already exists');
  return new HttpError(500, 'INTERNAL', message);
}

export async function handleCompanyFile(
  deps: Deps,
  caller: SupabaseClient,
  service: SupabaseClient,
  uid: string,
  body: { action?: unknown; contentType?: unknown; contentLength?: unknown; subjectId?: unknown },
  path: string,
): Promise<Response> {
  const bucket: LogicalBucket = 'company-entry-images';
  const parts = KEY.exec(path);
  if (!parts || body.subjectId !== parts[2]) {
    throw new HttpError(400, 'BAD_PATH', 'A company file needs a canonical key');
  }
  const groupId = parts[1] as string;
  const fileId = parts[2] as string;
  const action = body.action;
  const objectUrl = deps.objectUrl(bucket, path);
  const contentType = typeof body.contentType === 'string' ? body.contentType : '';
  const r2 = () => deps.r2().client;

  if (action === 'get') {
    const { data: allowed, error } = await caller.rpc('waves_can_read_company_file', {
      p_file_id: fileId,
      p_path: path,
    });
    if (error) throw new HttpError(500, 'INTERNAL', error.message);
    if (allowed !== true) throw new HttpError(403, 'NOT_VISIBLE', 'Not visible to you');
    const { data: object, error: objectError } = await service
      .from('storage_objects')
      .select('path')
      .eq('logical_bucket', bucket)
      .eq('path', path)
      .eq('pending', false)
      .maybeSingle();
    if (objectError) throw new HttpError(500, 'INTERNAL', objectError.message);
    if (!object) throw new HttpError(404, 'NOT_FOUND', 'No committed object');
    const getUrl = new URL(objectUrl);
    getUrl.searchParams.set('X-Amz-Expires', String(RESTRICTED_URL_TTL_SECONDS));
    // Always a download, never rendered in a browser under the bucket's origin.
    getUrl.searchParams.set('response-content-disposition', 'attachment');
    const signed = await r2().sign(new Request(getUrl), { aws: { signQuery: true } });
    return json({ url: signed.url });
  }

  if (action === 'put') {
    const declared = Number(body.contentLength);
    if (!Number.isFinite(declared) || declared <= 0) {
      throw new HttpError(400, 'BAD_LENGTH', 'contentLength is required');
    }
    if (declared > MAX_COMPANY_FILE_BYTES) {
      throw new HttpError(413, 'TOO_LARGE', 'That file is too large');
    }
    if (!COMPANY_FILE_TYPES.has(contentType)) {
      throw new HttpError(415, 'BAD_CONTENT_TYPE', 'That kind of file is not allowed');
    }
    const { error } = await service.rpc('waves_storage_reserve', {
      p_profile_id: uid,
      p_group_id: groupId,
      p_logical_bucket: bucket,
      p_path: path,
      p_bytes: declared,
      p_content_type: contentType,
    });
    if (error) throw companyFileDbError(error.message ?? '');
    const putUrl = new URL(objectUrl);
    putUrl.searchParams.set('X-Amz-Expires', String(RESTRICTED_URL_TTL_SECONDS));
    const uploadHeaders: Record<string, string> = {
      'content-type': contentType,
      'if-none-match': '*',
    };
    const signed = await r2().sign(new Request(putUrl, { method: 'PUT', headers: uploadHeaders }), {
      aws: { signQuery: true, allHeaders: true },
      headers: uploadHeaders,
    });
    return json({ url: signed.url, method: 'PUT', headers: uploadHeaders });
  }

  const cancel = async (): Promise<boolean> => {
    const { data, error } = await service.rpc('waves_company_cancel_upload', {
      p_entry_id: fileId,
      p_path: path,
      p_profile_id: uid,
      p_pending_only: true,
    });
    if (error) throw companyFileDbError(error.message ?? '');
    return data === true;
  };

  if (action === 'release') {
    if (await cancel()) await r2().fetch(objectUrl, { method: 'DELETE' });
    return json({ ok: true });
  }

  if (action === 'commit') {
    const head = await r2().fetch(objectUrl, { method: 'HEAD' });
    if (!head.ok) throw new HttpError(404, 'NOT_UPLOADED', 'Object was not uploaded');
    const size = Number(head.headers.get('content-length') ?? '0');
    const headType = head.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > MAX_COMPANY_FILE_BYTES ||
      !COMPANY_FILE_TYPES.has(headType)
    ) {
      // Wrong size or type: drop the reservation and the bytes (only while still pending).
      if (await cancel()) await r2().fetch(objectUrl, { method: 'DELETE' });
      throw new HttpError(413, 'TOO_LARGE', 'Invalid uploaded file');
    }
    const { error } = await service.rpc('waves_storage_record', {
      p_profile_id: uid,
      p_group_id: groupId,
      p_logical_bucket: bucket,
      p_path: path,
      p_bytes: size,
      p_content_type: headType,
    });
    if (error) {
      // Over the quota at the true size: free the reservation and the bytes.
      if (await cancel().catch(() => false)) await r2().fetch(objectUrl, { method: 'DELETE' });
      throw companyFileDbError(error.message ?? '');
    }
    return json({ ok: true, bytes: size });
  }

  throw new HttpError(400, 'BAD_ACTION', 'Unknown action');
}
