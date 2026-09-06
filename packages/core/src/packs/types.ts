/**
 * A pack: a set of categories or income sources somebody can install.
 *
 * The app ships ten spend categories and fifteen income sources, all deliberately
 * general — nothing that assumes one country's instruments or one person's trade.
 * That is right for a default and wrong as a final answer, because a landlord, a
 * freelancer and somebody tracking a chit fund all want vocabulary the app should
 * not ship to everybody. A pack is how they get it.
 *
 * **A pack is data, not code.** Labels, icons from a fixed set, tints from six.
 * There is nothing to execute, so there is no sandbox to build and nothing a pack
 * can do to a device beyond appearing in a picker. Installing one writes ordinary
 * custom tags into the person's own catalog (A42) through the ordinary queued
 * mutations — which is why an install works offline, and why an uninstall can
 * simply leave them behind: by then they are the person's own categories, with
 * their own expenses filed under them.
 *
 * `parsePack` is the gate, and it is deliberately total: anything a picker could
 * not draw is refused rather than repaired, on both sides. The admin console runs
 * it before publishing, and the client runs it again on what it fetched, because
 * a client that trusts the server to have validated is a client that renders a
 * blank box the first time something goes wrong upstream.
 */

import { isTagIcon } from '../category/tagIcons';
import { TINTS, type TintName } from '../category/catalog';

/** Which picker an entry belongs in. A tag is one or the other, never both — a
 *  salary is not a spending category and filing it as one is the bug this whole
 *  axis exists to prevent. */
export type CategoryAxis = 'expense' | 'income';

export const CATEGORY_AXES: readonly CategoryAxis[] = ['expense', 'income'];

export interface PackEntry {
  /** Stable within the pack, and the seed of the installed tag's id. Renaming an
   *  entry's label is an edit; changing its key makes a different category. */
  readonly key: string;
  readonly label: string;
  /** One of the curated glyphs — see `isTagIcon`. */
  readonly icon: string;
  readonly tint: TintName;
  readonly axis: CategoryAxis;
}

export interface Pack {
  readonly id: string;
  /** URL-safe, unique, and the thing a link to a pack is made of. */
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly entries: readonly PackEntry[];
  readonly version: number;
}

/** Where a pack is in its life. `unlisted` is the takedown: it stops being
 *  installable without touching a single person who already has it — their
 *  categories are their own by then, and pulling them back would rewrite
 *  somebody's history over a mistake that was not theirs. */
export type PackStatus = 'draft' | 'published' | 'unlisted';

export const PACK_STATUSES: readonly PackStatus[] = ['draft', 'published', 'unlisted'];

/** Caps. Each is a number somebody could argue with; what matters is that every
 *  one of them exists, so a malformed pack is refused rather than rendered. */
export const PACK_LIMITS = {
  /** Matches the tag label cap the editor and `/sync` already enforce. */
  label: 40,
  key: 64,
  title: 60,
  summary: 200,
  slug: 60,
  /** A picker nobody can scroll is not a gift. */
  entries: 50,
} as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function isTint(value: unknown): value is TintName {
  return typeof value === 'string' && (TINTS as readonly string[]).includes(value);
}

function isAxis(value: unknown): value is CategoryAxis {
  return value === 'expense' || value === 'income';
}

/**
 * One entry, or null if it is not one.
 *
 * Nothing here coerces. A missing tint could default to `sky` and a bad icon
 * could fall back to a pricetag, and both would ship somebody a pack quietly
 * unlike the one that was written — better to refuse it while an author is still
 * looking at the screen.
 */
export function parsePackEntry(value: unknown): PackEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const key = text(raw.key, PACK_LIMITS.key);
  if (!key || !KEY.test(key)) return null;
  const label = text(raw.label, PACK_LIMITS.label);
  if (!label) return null;
  if (!isTagIcon(raw.icon)) return null;
  if (!isTint(raw.tint)) return null;
  if (!isAxis(raw.axis)) return null;

  return { key, label, icon: raw.icon, tint: raw.tint, axis: raw.axis };
}

/** A whole pack, or null. A pack with one unusable entry is an unusable pack:
 *  installing "most of" what somebody chose is not a thing to do quietly. */
export function parsePack(value: unknown): Pack | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const id = text(raw.id, PACK_LIMITS.key);
  const slug = text(raw.slug, PACK_LIMITS.slug);
  const title = text(raw.title, PACK_LIMITS.title);
  const summary = text(raw.summary, PACK_LIMITS.summary);
  if (!id || !slug || !SLUG.test(slug) || !title || !summary) return null;

  const version =
    typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version > 0
      ? raw.version
      : 1;

  if (!Array.isArray(raw.entries)) return null;
  if (raw.entries.length === 0 || raw.entries.length > PACK_LIMITS.entries) return null;

  const entries: PackEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of raw.entries) {
    const entry = parsePackEntry(candidate);
    if (!entry) return null;
    // Two entries with one key would install as one tag, so the pack would
    // silently deliver fewer categories than it lists.
    if (seen.has(entry.key)) return null;
    seen.add(entry.key);
    entries.push(entry);
  }

  return { id, slug, title, summary, entries, version };
}
