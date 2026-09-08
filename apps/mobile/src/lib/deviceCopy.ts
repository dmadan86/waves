/**
 * "Download a copy" — the native half of the sign-out snapshot.
 *
 * Signing out wipes this device's mirror, its queue and its drafts, so the one
 * thing the sheet has to be able to offer is a copy taken *before* that
 * happens. This writes the pure snapshot from `@waves/core` (`deviceSnapshot`)
 * to a cache file, hands it to the system share sheet — where the person picks
 * Files, Drive, mail, whatever they trust — and deletes the temporary
 * afterwards, exactly as the export screen does with a server export.
 *
 * It never touches the network. That is the point: the copy has to work in the
 * case it exists for, which is a device holding changes that could not be sent.
 *
 * One thing it deliberately does not hold: unsent receipt photographs. This is
 * a JSON file somebody may keep for years, and base64 image bytes would turn a
 * few kilobytes into tens of megabytes. The sheet says so in words rather than
 * letting the file quietly not contain them.
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  deviceSnapshot,
  snapshotFilename,
  type DeviceDraft,
  type MirrorState,
  type QueuedMutation,
} from '@waves/core';

export interface DeviceCopyResult {
  readonly filename: string;
  readonly sizeBytes: number;
  /** False when the platform has no share sheet — the file was still written. */
  readonly shared: boolean;
}

/**
 * Take the copy and offer it to the share sheet.
 *
 * Resolves once the share sheet has been dismissed (or immediately, on a
 * platform without one). The caller shows the filename and size; anything
 * thrown lands in its own error line.
 */
export async function saveDeviceCopy(input: {
  readonly mirror: MirrorState;
  readonly queue: readonly QueuedMutation[];
  /** The autosaved forms, read by the caller — the same ones it counted. */
  readonly drafts: readonly DeviceDraft[];
  readonly ownerId: string;
  readonly dialogTitle: string;
}): Promise<DeviceCopyResult> {
  const exportedAt = new Date().toISOString();
  const snapshot = deviceSnapshot({
    mirror: input.mirror,
    queue: input.queue,
    drafts: input.drafts,
    ownerId: input.ownerId,
    exportedAt,
  });
  // Indented: this file is read by a person in a moment of "did I lose it?",
  // and the few extra kilobytes buy a file they can actually scroll.
  const body = JSON.stringify(snapshot, null, 2);
  const filename = snapshotFilename(exportedAt);

  // expo-file-system 57 API: File/Paths rather than the old string paths.
  const file = new FileSystem.File(FileSystem.Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(body);

  let shared = false;
  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: input.dialogTitle,
        UTI: 'public.json',
      });
      shared = true;
    }
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // Best-effort privacy cleanup; the share result still drives the UI.
    }
  }

  return { filename, sizeBytes: body.length, shared };
}
