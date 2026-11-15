'use client';

/**
 * Image upload for the browser, ported from the phone's storage seam: with R2 on,
 * `r2-sign` brokers a presigned PUT (and enforces the storage cap at commit); with
 * it off, a direct Supabase Storage upload.
 */

import { supabase } from '@/lib/waves';

const r2Enabled = process.env.NEXT_PUBLIC_R2_ENABLED === 'true';

export type LogicalBucket =
  | 'receipts'
  | 'group-photos'
  | 'avatars'
  | 'captures'
  | 'settlement-proofs'
  | 'expense-attachments'
  | 'company-entry-images';

const RESTRICTED: ReadonlySet<LogicalBucket> = new Set([
  'settlement-proofs',
  'expense-attachments',
  'company-entry-images',
]);

/** The free-tier storage ceiling was hit: the one refusal the person can act on. */
export class StorageCapError extends Error {
  constructor(message = 'You have reached your free storage limit.') {
    super(message);
    this.name = 'StorageCapError';
  }
}

export interface PutImageInput {
  bucket: LogicalBucket;
  /** Object path within the bucket, e.g. `<groupId>/logo.webp`. */
  path: string;
  body: Blob | ArrayBuffer;
  contentType: string;
  /** The group the bytes are charged to, for the storage-cap rule. */
  groupId?: string | null;
  /** For a restricted bucket, the expense or settlement the object belongs to. */
  subjectId?: string | null;
}

async function asStorageError(error: unknown): Promise<Error> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const parsed = (await context.clone().json()) as { code?: string; message?: string };
      if (parsed.code === 'STORAGE_CAP') return new StorageCapError(parsed.message);
      if (parsed.message) return new Error(parsed.message);
    } catch {
      // not JSON
    }
  }
  return error instanceof Error ? error : new Error('Storage request failed');
}

async function signCall(
  body: Record<string, unknown>,
): Promise<{ url?: string; headers?: Record<string, string> }> {
  const { data, error } = await supabase.functions.invoke('r2-sign', { body });
  if (error) throw await asStorageError(error);
  return (data ?? {}) as { url?: string; headers?: Record<string, string> };
}

/** Store an image and return its path. @throws StorageCapError when a free account is out of storage. */
export async function putImage(input: PutImageInput): Promise<string> {
  const size = input.body instanceof Blob ? input.body.size : input.body.byteLength;
  if (RESTRICTED.has(input.bucket)) {
    if (!r2Enabled) throw new Error('Private attachments need cloud storage enabled');
    if (!input.subjectId) throw new Error('A private attachment needs its subject');
  }

  if (!r2Enabled) {
    const { error } = await supabase.storage
      .from(input.bucket)
      .upload(input.path, input.body, { contentType: input.contentType, upsert: true });
    if (error) throw new Error(error.message);
    return input.path;
  }

  const { url, headers } = await signCall({
    action: 'put',
    bucket: input.bucket,
    path: input.path,
    contentType: input.contentType,
    contentLength: size,
    groupId: input.groupId ?? null,
    subjectId: input.subjectId ?? null,
  });
  if (!url) throw new Error('Could not start the upload');

  // `put` reserved the bytes; any failure below must release the reservation.
  const release = () =>
    signCall({
      action: 'release',
      bucket: input.bucket,
      path: input.path,
      subjectId: input.subjectId ?? null,
    }).catch(() => {});

  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': input.contentType, ...headers },
    body: input.body,
  }).catch(async (cause: unknown) => {
    await release();
    throw new Error(`Upload failed: ${cause instanceof Error ? cause.message : 'network error'}`);
  });
  if (!put.ok) {
    await release();
    throw new Error(`Upload failed (${put.status})`);
  }

  await signCall({
    action: 'commit',
    bucket: input.bucket,
    path: input.path,
    contentType: input.contentType,
    groupId: input.groupId ?? null,
    subjectId: input.subjectId ?? null,
  });
  return input.path;
}
