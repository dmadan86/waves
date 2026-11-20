/**
 * What one voice clip tells us about the speech engine — never what was said.
 * Short lowercase words only, so it passes `sanitizeProps` and the database's
 * own filter. Pure, so it is tested without a device.
 */

import type { EventProps } from '@/lib/eventsCore';
import { serviceWord } from '@/lib/speechServicePure';

export type ClipEngine = 'cloud-stream' | 'cloud-batch' | 'phone';

/** Lowercase, anything outside [a-z0-9_-] becomes `_`, at most 32 characters; '' when empty. */
export function word(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, 32);
}

export interface ClipFacts {
  engine: ClipEngine | null;
  /** The Android service package used by the phone recogniser. */
  servicePackage?: string;
  platform: string;
  osVersion?: string | null;
  make?: string | null;
  error?: string | null;
  firstWordMs: number | null;
}

export function clipProps(f: ClipFacts): EventProps {
  const props: EventProps = {};
  const set = (key: keyof EventProps, value: string): void => {
    if (value) props[key] = value;
  };
  set('engine', word(f.engine ?? 'none'));
  if (f.engine === 'phone' && f.platform === 'android')
    set('service', serviceWord(f.servicePackage));
  set('os', word(f.osVersion?.split('.')[0]));
  set('make', word(f.make));
  set('error', word(f.error));
  if (f.firstWordMs !== null) set('ms', String(Math.max(0, Math.round(f.firstWordMs))));
  return props;
}
