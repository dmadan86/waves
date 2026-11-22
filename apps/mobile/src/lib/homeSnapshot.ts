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
  /** Needs you: the action pill is the filled (pay) kind. */
  strong?: boolean;
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

const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown): boolean => v === undefined || v === null || isStr(v);
const isInt = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const isBigIntText = (v: unknown): boolean => {
  if (!isStr(v)) return false;
  try {
    BigInt(v);
    return /^-?\d+$/.test(v);
  } catch {
    return false;
  }
};

function isRow(value: unknown): value is SnapRow {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isStr(r.key) &&
    isStr(r.title) &&
    isStr(r.memberLabel) &&
    isStr(r.amountText) &&
    isStr(r.directionLabel) &&
    [r.icon, r.href, r.tone, r.currency, r.statusLabel].every((v) => v === undefined || isStr(v)) &&
    [
      r.draftLabel,
      r.coverEmoji,
      r.coverColor,
      r.groupType,
      r.eventTemplate,
      r.customTag,
      r.pendingLabel,
      r.tag,
    ].every(optStr) &&
    (r.balance === undefined || isBigIntText(r.balance)) &&
    [r.isDemo, r.strong].every((v) => v === undefined || typeof v === 'boolean')
  );
}

const isRows = (value: unknown): value is SnapRow[] => Array.isArray(value) && value.every(isRow);

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
    if (!isInt(h.owedGroups) || !isInt(h.owingGroups) || !isInt(s.needsTotal)) return null;
    if (!isRows(s.needs) || !isRows(s.comingUp) || !isRows(s.groups)) return null;
    if (s.personal !== null && !isRow(s.personal)) return null;
    return s;
  } catch {
    return null;
  }
}
