/**
 * Home's last good frame, kept so a cold start paints at once and then updates
 * in place (stale-while-revalidate). Pure helpers only: the encrypted storage
 * lives in `homeSnapshotStore.ts`. Every figure is a string (bigints go through
 * JSON as text) and every row is keyed, so live data swaps in without a jump.
 */

/** One row of any Home list, as the shared row component draws it. */
export interface SnapRow {
  key: string;
  title: string;
  memberLabel: string;
  amountText: string;
  directionLabel: string;
  /** Ionicons name, for rows with a glyph instead of a group cover. */
  icon?: string;
  href?: string;
  tone?: string;
  /** Group-only extras. */
  draftLabel?: string | null;
  coverEmoji?: string | null;
  coverColor?: string | null;
  groupType?: string | null;
  eventTemplate?: string | null;
  customTag?: string | null;
  balance?: string;
  currency?: string;
  statusLabel?: string;
  pendingLabel?: string | null;
  tag?: string | null;
  isDemo?: boolean;
}

export interface HomeSnapshot {
  v: 1;
  viewerId: string;
  headline: {
    currency: string;
    net: string;
    owed: string;
    owing: string;
    owedGroups: number;
    owingGroups: number;
  };
  needs: SnapRow[];
  needsTotal: number;
  comingUp: SnapRow[];
  personal: SnapRow | null;
  groups: SnapRow[];
}

/** Storage key; per account, so one account's frame is never read for another. */
export const snapshotKey = (viewerId: string): string => `home:snapshot:v1:${viewerId}`;

export const serialiseSnapshot = (snapshot: HomeSnapshot): string => JSON.stringify(snapshot);

const isRows = (value: unknown): value is SnapRow[] =>
  Array.isArray(value) &&
  value.every((row) => typeof row === 'object' && row !== null && typeof row.key === 'string');

/** The snapshot for `viewerId`, or null for anything malformed or someone else's. */
export function parseSnapshot(raw: string | null, viewerId: string): HomeSnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as HomeSnapshot;
    if (s.v !== 1 || s.viewerId !== viewerId) return null;
    const h = s.headline;
    if (!h || typeof h.currency !== 'string' || ![h.net, h.owed, h.owing].every(isBigIntText)) {
      return null;
    }
    if (!isRows(s.needs) || !isRows(s.comingUp) || !isRows(s.groups)) return null;
    if (s.personal !== null && !isRows([s.personal])) return null;
    return s;
  } catch {
    return null;
  }
}

const isBigIntText = (value: unknown): boolean =>
  typeof value === 'string' && /^-?\d+$/.test(value);
