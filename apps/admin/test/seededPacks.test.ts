/**
 * The packs we seed have to survive the gate we wrote.
 *
 * A seeded pack goes into the database as raw SQL, so it never passes through
 * `parsePack` on the way in. If one carries a glyph that does not exist or a
 * tint outside the six, the client does the only safe thing and drops it — and
 * the pack is simply missing from the shelf, with nothing anywhere saying why.
 * A typo in a seed would be invisible until somebody noticed the shelf was
 * shorter than it should be.
 *
 * It lives in the admin package rather than in core because it reads a file, and
 * `@waves/core` is deliberately platform-neutral — it runs in Deno and on a
 * phone, and giving it Node types to accommodate one test would be the wrong
 * trade. This is also the package that publishes packs, so it is the right place
 * for the check that they are publishable.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePack, PACK_LIMITS } from '@waves/core';

const MIGRATIONS = join(process.cwd(), '..', '..', 'packages', 'db', 'prisma', 'migrations');

/** Every `INSERT INTO public.packs` seed migration, by name. */
function seedFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.includes('seed_category_packs'))
    .map((name) => join(MIGRATIONS, name, 'migration.sql'));
}

/** The `(slug, title, summary, status, version, entries)` tuples, as packs. */
function packsIn(sql: string): { slug: string; pack: unknown }[] {
  const out: { slug: string; pack: unknown }[] = [];
  const rows = sql.matchAll(
    /\(\s*'([a-z0-9-]+)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'\w+',\s*(\d+),\s*'(\[[\s\S]*?\])'::jsonb\s*\)/g,
  );
  for (const row of rows) {
    const [, slug, title, summary, version, entries] = row;
    out.push({
      slug: slug!,
      pack: {
        id: `seed-${slug}`,
        slug,
        // SQL escapes a quote by doubling it; undo that before measuring length.
        title: title!.replace(/''/g, "'"),
        summary: summary!.replace(/''/g, "'"),
        version: Number(version),
        entries: JSON.parse(entries!),
      },
    });
  }
  return out;
}

describe('the packs we ship', () => {
  const files = seedFiles();

  it('has a seed migration at all', () => {
    // If this fails the glob is wrong and every assertion below is vacuous.
    expect(files.length).toBeGreaterThan(0);
  });

  const seeded = files.flatMap((file) => packsIn(readFileSync(file, 'utf8')));

  it('found the packs inside it', () => {
    expect(seeded.length).toBeGreaterThanOrEqual(5);
  });

  it.each(seeded.map((entry) => [entry.slug, entry.pack] as const))(
    'ships %s through the same gate the client uses',
    (_slug, raw) => {
      // A failure here is a real glyph or tint typo: the client would drop this
      // pack, and the shelf would be quietly one shorter.
      expect(parsePack(raw)).not.toBeNull();
    },
  );

  it('gives every pack a distinct slug', () => {
    const slugs = seeded.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('keeps every pack inside the limits', () => {
    for (const { pack } of seeded) {
      const parsed = parsePack(pack)!;
      expect(parsed.entries.length).toBeLessThanOrEqual(PACK_LIMITS.entries);
      expect(parsed.entries.length).toBeGreaterThan(0);
    }
  });
});
