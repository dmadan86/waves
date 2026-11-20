/**
 * The one muted line under the mic in preview and dev builds: which engine
 * heard the sentence and how fast it got going. Never shown in production.
 */

export type DiagEngine = 'cloud-stream' | 'cloud-batch' | 'phone';

export interface VoiceDiag {
  engine: DiagEngine;
  /** Press to first audio frame (ms), or null when none arrived. */
  firstFrameMs: number | null;
  /** Press to stream attached (ms); null when it never was or no stream was tried. */
  attachMs: number | null;
  /** Why the stream did not attach, when it did not. */
  attachFailed: string | null;
  /** Characters in the final transcript, or null while still listening. */
  chars: number | null;
  /** The Android speech service package the phone recogniser used (engine=phone). */
  service?: string;
}

/** On for `__DEV__` and for builds made with `EXPO_PUBLIC_VOICE_DIAG=true` (the preview profile). */
export const VOICE_DIAG_ENABLED: boolean =
  (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_VOICE_DIAG === 'true';

const ms = (value: number | null): string => (value === null ? '-' : `${Math.round(value)}ms`);

export function formatVoiceDiag(d: VoiceDiag): string {
  const attach = d.attachFailed
    ? `attach failed: ${d.attachFailed}`
    : d.engine === 'phone'
      ? 'attach n/a'
      : `attach ${ms(d.attachMs)}`;
  const service =
    d.engine === 'phone' && d.service
      ? `svc ${d.service.replace(/^com\.(google\.)?(android\.)?/, '')}`
      : null;
  return [
    d.engine,
    ...(service ? [service] : []),
    `1st frame ${ms(d.firstFrameMs)}`,
    attach,
    `${d.chars ?? '…'} chars`,
  ].join(' · ');
}
