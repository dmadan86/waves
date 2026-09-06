/**
 * Packs: what is allowed in, and what installing one writes.
 *
 * `parsePack` is the only gate between an authored pack and a picker on
 * somebody's phone, and it runs on both sides of the wire. Every rejection below
 * is a thing that would otherwise render as a blank box, a missing category, or
 * a salary filed as a spending category — so the interesting tests here are the
 * refusals, not the happy path.
 */

import { describe, expect, it } from 'vitest';

import {
  installPlan,
  packTagId,
  parsePack,
  parsePackEntry,
  PACK_LIMITS,
  type CategoryTagRow,
  type Pack,
} from '../src/index.js';

const entry = (over: Record<string, unknown> = {}) => ({
  key: 'chit-fund',
  label: 'Chit fund',
  icon: 'cash-outline',
  tint: 'mint',
  axis: 'expense',
  ...over,
});

const pack = (over: Record<string, unknown> = {}) => ({
  id: 'pack-1',
  slug: 'india-everyday',
  title: 'India · everyday',
  summary: 'The categories an everyday Indian household actually uses.',
  version: 1,
  entries: [entry()],
  ...over,
});

const tagRow = (id: string): CategoryTagRow => ({
  id,
  builtinId: null,
  label: 'Whatever',
  icon: 'cash-outline',
  tint: 'mint',
  sortOrder: 20,
  hidden: false,
});

describe('parsePackEntry', () => {
  it('accepts an entry a picker can draw', () => {
    expect(parsePackEntry(entry())).toEqual({
      key: 'chit-fund',
      label: 'Chit fund',
      icon: 'cash-outline',
      tint: 'mint',
      axis: 'expense',
    });
  });

  it('refuses a glyph that does not exist', () => {
    // The reason the icon list moved into core. Nothing downstream would have
    // caught this: it renders as a blank box on every device that installs it.
    expect(parsePackEntry(entry({ icon: 'chit-fund-outline' }))).toBeNull();
    expect(parsePackEntry(entry({ icon: 'restaurant' }))).toBeNull();
  });

  it('refuses a tint outside the six', () => {
    // Coercing to a default would ship a pack quietly unlike the one written.
    expect(parsePackEntry(entry({ tint: 'burgundy' }))).toBeNull();
  });

  it('refuses an axis that is neither picker', () => {
    expect(parsePackEntry(entry({ axis: 'both' }))).toBeNull();
    expect(parsePackEntry(entry({ axis: undefined }))).toBeNull();
  });

  it('refuses a label that is empty, blank, or past the cap', () => {
    expect(parsePackEntry(entry({ label: '' }))).toBeNull();
    expect(parsePackEntry(entry({ label: '   ' }))).toBeNull();
    expect(parsePackEntry(entry({ label: 'x'.repeat(PACK_LIMITS.label + 1) }))).toBeNull();
    expect(parsePackEntry(entry({ label: 'x'.repeat(PACK_LIMITS.label) }))).not.toBeNull();
  });

  it('trims a label rather than failing over its whitespace', () => {
    expect(parsePackEntry(entry({ label: '  Chit fund  ' }))?.label).toBe('Chit fund');
  });

  it('refuses a key that is not a key', () => {
    expect(parsePackEntry(entry({ key: 'Chit Fund' }))).toBeNull();
    expect(parsePackEntry(entry({ key: '' }))).toBeNull();
    expect(parsePackEntry(entry({ key: 'chit fund' }))).toBeNull();
    // Separators are allowed. Kept deliberately short: the secret scanner reads
    // a longer mixed-punctuation string beside the word `key` as a leaked
    // token, and a smaller fixture is a better answer than an allowlist entry
    // that would blunt the scanner for everything after it.
    expect(parsePackEntry(entry({ key: 'a.b_c-d' }))).not.toBeNull();
  });

  it('refuses anything that is not an object at all', () => {
    for (const value of [null, undefined, 'chit-fund', 42, []]) {
      expect(parsePackEntry(value)).toBeNull();
    }
  });
});

describe('parsePack', () => {
  it('accepts a whole pack', () => {
    const parsed = parsePack(pack());
    expect(parsed?.slug).toBe('india-everyday');
    expect(parsed?.entries).toHaveLength(1);
  });

  it('refuses a pack because one entry is unusable', () => {
    // Installing "most of" what somebody chose is not a thing to do quietly.
    const half = pack({ entries: [entry(), entry({ key: 'kirana', icon: 'not-a-glyph' })] });
    expect(parsePack(half)).toBeNull();
  });

  it('refuses two entries sharing a key', () => {
    // They would install as one tag, so the pack would deliver fewer categories
    // than it lists — and nothing would say so.
    const clash = pack({ entries: [entry(), entry({ label: 'Chit fund II' })] });
    expect(parsePack(clash)).toBeNull();
  });

  it('refuses an empty pack and an enormous one', () => {
    expect(parsePack(pack({ entries: [] }))).toBeNull();
    const many = Array.from({ length: PACK_LIMITS.entries + 1 }, (_, i) => entry({ key: `k${i}` }));
    expect(parsePack(pack({ entries: many }))).toBeNull();
  });

  it('refuses a slug that could not sit in a URL', () => {
    for (const slug of ['India Everyday', 'india_everyday', '-india', 'india-', '']) {
      expect(parsePack(pack({ slug }))).toBeNull();
    }
  });

  it('requires a title and a summary', () => {
    expect(parsePack(pack({ title: '' }))).toBeNull();
    expect(parsePack(pack({ summary: '   ' }))).toBeNull();
  });

  it('defaults a missing or nonsense version to 1 rather than failing', () => {
    // A version is bookkeeping, not meaning — worth repairing, unlike an icon.
    expect(parsePack(pack({ version: undefined }))?.version).toBe(1);
    expect(parsePack(pack({ version: 0 }))?.version).toBe(1);
    expect(parsePack(pack({ version: 2.5 }))?.version).toBe(1);
    expect(parsePack(pack({ version: 3 }))?.version).toBe(3);
  });

  it('refuses entries that are not a list', () => {
    expect(parsePack(pack({ entries: 'chit-fund' }))).toBeNull();
    expect(parsePack(pack({ entries: undefined }))).toBeNull();
  });
});

describe('packTagId', () => {
  it('is the same every time', () => {
    expect(packTagId('pack-1', 'chit-fund')).toBe(packTagId('pack-1', 'chit-fund'));
  });

  it('separates entries, and packs', () => {
    expect(packTagId('pack-1', 'chit-fund')).not.toBe(packTagId('pack-1', 'kirana'));
    expect(packTagId('pack-1', 'chit-fund')).not.toBe(packTagId('pack-2', 'chit-fund'));
  });

  it('is shaped like a uuid, because a uuid column holds it', () => {
    expect(packTagId('pack-1', 'chit-fund')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('installPlan', () => {
  const twoEntries = parsePack(
    pack({ entries: [entry(), entry({ key: 'kirana', label: 'Kirana' })] }),
  ) as Pack;

  it('writes every entry into an empty catalog', () => {
    const plan = installPlan(twoEntries, []);
    expect(plan.create).toHaveLength(2);
    expect(plan.alreadyPresent).toBe(0);
    expect(plan.create[0]).toMatchObject({
      tagId: packTagId(twoEntries.id, 'chit-fund'),
      label: 'Chit fund',
      builtinId: null,
      axis: 'expense',
      hidden: false,
    });
  });

  it('installs twice as though it had installed once', () => {
    const already = twoEntries.entries.map((e) => tagRow(packTagId(twoEntries.id, e.key)));
    const plan = installPlan(twoEntries, already);
    expect(plan.create).toEqual([]);
    expect(plan.alreadyPresent).toBe(2);
  });

  it('adds only what is new when a pack has grown', () => {
    const half = [tagRow(packTagId(twoEntries.id, 'chit-fund'))];
    const plan = installPlan(twoEntries, half);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]?.label).toBe('Kirana');
    expect(plan.alreadyPresent).toBe(1);
  });

  it('never overwrites a tag somebody has made their own', () => {
    // Installed, renamed, then the pack is installed again: their name stands.
    const renamed: CategoryTagRow = {
      ...tagRow(packTagId(twoEntries.id, 'chit-fund')),
      label: 'My committee',
    };
    const plan = installPlan(twoEntries, [renamed]);
    expect(plan.create.map((p) => p.tagId)).not.toContain(renamed.id);
  });

  it('lands after what the catalog already holds, in the pack’s own order', () => {
    const existing = [{ ...tagRow('other-tag'), sortOrder: 40 }];
    const plan = installPlan(twoEntries, existing);
    expect(plan.create[0]!.sortOrder).toBe(41);
    expect(plan.create[1]!.sortOrder).toBe(42);
  });

  it('carries each entry into the picker it belongs in', () => {
    const mixed = parsePack(
      pack({
        entries: [entry(), entry({ key: 'rent-in', label: 'Rent in', axis: 'income' })],
      }),
    ) as Pack;
    const plan = installPlan(mixed, []);
    expect(plan.create.map((p) => p.axis)).toEqual(['expense', 'income']);
  });
});
