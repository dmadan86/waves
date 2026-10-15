/**
 * How the Campaigns table reads: a label for the tag and the share of installs
 * that got somewhere. Pure and dependency-free so a test can import it
 * (`lib/data` is `server-only`).
 */
import { percent, ratio } from './kpiStatus';

/** The tag shown for an install that carried none. */
export const NO_TAG = '(none)';

export interface CampaignRowLike {
  source: string;
  medium: string;
  campaign: string;
}

/** `meta / paid / diwali_in`, with a missing part kept visible as `(none)`. */
export function campaignLabel(row: CampaignRowLike): string {
  return [row.source, row.medium, row.campaign].map((part) => part || NO_TAG).join(' / ');
}

/** A bigint column arrives as a number or a string. */
const count = (value: number | string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** `3 · 30.0%` of installs, or a dash for the share when there are no installs. */
export function ofInstalls(value: number | string, installs: number | string): string {
  const share = ratio(count(value), count(installs));
  return share === null ? `${count(value)}` : `${count(value)} · ${percent(share)}`;
}
