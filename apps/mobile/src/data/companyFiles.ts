/**
 * Company Files: folders, uploaded files and links.
 *
 * Reads come from the sync mirror (row-level security already limits each row to the roles its visibility names, and a
 * vendor login gets none). Writes are direct online RPCs, like photos: the bytes need an upload anyway.
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { rowsFor, SyncTable, uploadMime, type CompanyFileVisibility } from '@waves/core';

import { backend } from '@/lib/backend';
import { putCompanyFile, restrictedImageUrl } from '@/lib/storage';
import { useSync } from '@/sync';

export const MAX_COMPANY_FILE_BYTES = 25 * 1024 * 1024;

export interface CompanyFolder {
  readonly id: string;
  readonly name: string;
  readonly visibility: CompanyFileVisibility;
  readonly createdBy: string;
}
export interface CompanyFile {
  readonly id: string;
  readonly folderId: string | null;
  readonly kind: 'file' | 'link';
  readonly name: string;
  readonly url: string | null;
  readonly r2Key: string | null;
  readonly sizeBytes: number;
  readonly mime: string | null;
  readonly visibility: CompanyFileVisibility;
  readonly createdBy: string;
  readonly createdAt: string;
}

type Row = Record<string, unknown>;

export function useCompanyFiles(groupId: string): {
  folders: CompanyFolder[];
  files: CompanyFile[];
} {
  const { mirror } = useSync();
  return useMemo(() => {
    const live = (table: SyncTable) =>
      (rowsFor(mirror, table, groupId) as unknown as Row[]).filter((r) => r.deleted_at == null);
    const folders = live(SyncTable.CompanyFileFolders)
      .map((r) => ({
        id: r.id as string,
        name: String(r.name),
        visibility: r.visibility as CompanyFileVisibility,
        createdBy: r.created_by as string,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = live(SyncTable.CompanyFiles)
      .map((r) => ({
        id: r.id as string,
        folderId: (r.folder_id as string | null) ?? null,
        kind: r.kind as 'file' | 'link',
        name: String(r.name),
        url: (r.url as string | null) ?? null,
        r2Key: (r.r2_key as string | null) ?? null,
        sizeBytes: Number(r.size_bytes ?? 0),
        mime: (r.mime as string | null) ?? null,
        visibility: r.visibility as CompanyFileVisibility,
        createdBy: r.created_by as string,
        createdAt: String(r.created_at ?? ''),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { folders, files };
  }, [mirror, groupId]);
}

async function rpc(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await backend.rpc(name, args);
  if (error) throw new Error(error.message);
}

/** Every write the Files screen makes; each pulls the change back so the list updates at once. */
export function useCompanyFileActions(groupId: string) {
  const { flush } = useSync();
  const done = () => void flush([groupId]);
  const run = <T>(fn: (input: T) => Promise<unknown>) => ({
    mutationFn: async (input: T) => {
      await fn(input);
    },
    onSuccess: done,
  });
  return {
    saveFolder: useMutation(
      run((i: { id?: string; name: string; visibility: CompanyFileVisibility }) =>
        rpc('waves_company_file_folder_set', {
          p_group_id: groupId,
          p_id: i.id ?? randomUUID(),
          p_name: i.name,
          p_visibility: i.visibility,
        }),
      ),
    ),
    deleteFolder: useMutation(
      run((id: string) => rpc('waves_company_file_folder_delete', { p_id: id })),
    ),
    addLink: useMutation(
      run(
        (i: {
          name: string;
          url: string;
          visibility: CompanyFileVisibility;
          folderId: string | null;
        }) =>
          rpc('waves_company_file_create', {
            p_group_id: groupId,
            p_id: randomUUID(),
            p_folder_id: i.folderId,
            p_kind: 'link',
            p_name: i.name,
            p_visibility: i.visibility,
            p_url: i.url,
          }),
      ),
    ),
    update: useMutation(
      run(
        (i: { file: CompanyFile; name: string; visibility: CompanyFileVisibility; url?: string }) =>
          rpc('waves_company_file_update', {
            p_id: i.file.id,
            p_folder_id: i.file.folderId,
            p_name: i.name,
            p_visibility: i.visibility,
            p_url: i.file.kind === 'link' ? (i.url ?? i.file.url) : null,
          }),
      ),
    ),
    remove: useMutation(run((id: string) => rpc('waves_company_file_delete', { p_id: id }))),
    /** Upload one picked file into a folder (or the top), then register it. A failed register frees the bytes. */
    upload: useMutation(
      run(
        async (i: {
          uri: string;
          name: string;
          mime: string;
          folderId: string | null;
          visibility: CompanyFileVisibility;
        }) => {
          const file = new FileSystem.File(i.uri);
          const bytes = await file.bytes();
          const id = randomUUID();
          await putCompanyFile({ groupId, fileId: id, bytes, contentType: i.mime });
          try {
            await rpc('waves_company_file_create', {
              p_group_id: groupId,
              p_id: id,
              p_folder_id: i.folderId,
              p_kind: 'file',
              p_name: i.name,
              p_visibility: i.visibility,
            });
          } finally {
            // The picker's copy is a private cache file; the swept-orphan rule frees an unregistered upload within a day.
            try {
              if (file.exists) file.delete();
            } catch {
              // Best-effort cleanup.
            }
          }
        },
      ),
    ),
  };
}

/** Download an uploaded file to the cache and hand it to the system share sheet / viewer. False when it cannot be fetched. */
export async function openCompanyFile(file: CompanyFile): Promise<boolean> {
  if (!file.r2Key) return false;
  const url = await restrictedImageUrl('company-entry-images', file.id, file.r2Key);
  if (!url) return false;
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'file';
  const target = new FileSystem.File(FileSystem.Paths.cache, `${file.id}-${safe}`);
  if (target.exists) target.delete();
  const saved = await FileSystem.File.downloadFileAsync(url, target);
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(saved.uri, {
    mimeType: file.mime ?? uploadMime(file.name) ?? undefined,
    dialogTitle: file.name,
  });
  return true;
}
