import { createVerify } from 'node:crypto';

/**
 * Trust check for rollback: the signed metadata.json must verify against the
 * certificate AND say it was published for exactly this runtime, channel,
 * platform and folder, so metadata copied from another runtime/channel in the
 * bucket cannot be re-signed for this one. Returns the parsed metadata or throws.
 */
export function verifyPublishedMetadata({
  text,
  signature,
  publicKey,
  runtime,
  channel,
  platform,
  folder,
}) {
  const ok =
    !!signature &&
    createVerify('RSA-SHA256').update(text).verify(publicKey, signature.trim(), 'base64');
  if (!ok) throw new Error('bad signature');
  const metadata = JSON.parse(text);
  const b = metadata.otaBinding;
  if (
    !b ||
    b.runtimeVersion !== runtime ||
    b.channel !== channel ||
    b.folder !== folder ||
    !Array.isArray(b.platforms) ||
    !b.platforms.includes(platform)
  ) {
    throw new Error('signed for a different runtime, channel, platform or folder');
  }
  const files = metadata.fileMetadata?.[platform];
  const wanted = files ? [files.bundle, ...(files.assets ?? []).map((a) => a.path)] : [];
  if (!files?.bundle || !wanted.every((path) => metadata.hashes?.[path])) {
    throw new Error(`not published for ${platform}`);
  }
  return metadata;
}
