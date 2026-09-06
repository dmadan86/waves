/**
 * The two things the pack feature asks of the sync boundary.
 *
 * **A tag's icon must be a glyph that exists.** For as long as a picker was the
 * only writer of a tag this could not be wrong, so `/sync` only capped the
 * string's length. A pack is a second writer, authored somewhere else, and a
 * glyph that does not exist renders as a blank box on every device that installs
 * it — with nothing, anywhere, having said no.
 *
 * **An install is only ever of a published pack.** `packs` is readable by
 * `authenticated` only where `status = 'published'`, so reading it as the caller
 * *is* the check: a draft or a withdrawn pack is not there to be found. The test
 * for that is the stub returning null, which is exactly what RLS does.
 *
 * Driven with a stubbed Supabase client — no Deno, no network, no database.
 */

import { describe, expect, it, vi } from 'vitest';

import { SyncSession } from './index.ts';

const OWNER = 'owner-profile-id';
const PACK_ID = '99999999-8888-7777-6666-555555555555';
const INSTALL_ID = '11111111-2222-3333-4444-555555555555';
const TAG_ID = '22222222-3333-4444-5555-666666666666';

interface CallerOptions {
  /** What a select of the pack returns — null is what RLS does to a draft. */
  pack?: { id: string } | null;
}

function caller(options: CallerOptions = {}) {
  const upsert = vi.fn(() => Promise.resolve({ error: null }));
  const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
  const maybeSingle = vi.fn(() =>
    Promise.resolve({
      data: options.pack === undefined ? { id: PACK_ID } : options.pack,
      error: null,
    }),
  );
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = { upsert, update };
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = maybeSingle;
    return builder;
  });
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return { client: { from, rpc } as never, upsert, update, from };
}

function service() {
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = { insert: () => Promise.resolve({ error: null }) };
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { from } as never;
}

function mutation(kind: string, groupId: string, payload: Record<string, unknown>) {
  return {
    clientMutationId: `${kind}-1`,
    kind,
    groupId,
    seq: 1,
    clientCreatedAt: '2026-09-06T04:00:00.000Z',
    payload,
  } as never;
}

const tagScope = `${OWNER}:category_tags`;
const packScope = `${OWNER}:pack_installs`;

const tag = (over: Record<string, unknown> = {}) => ({
  tagId: TAG_ID,
  label: 'Chit fund',
  icon: 'cash-outline',
  tint: 'mint',
  sortOrder: 12,
  hidden: false,
  ...over,
});

describe('tag icons at the sync boundary', () => {
  it('accepts a glyph from the curated set', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(mutation('tag.create', tagScope, tag()));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ icon: 'cash-outline', axis: 'expense' }),
      expect.anything(),
    );
  });

  it('refuses a glyph that does not exist', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(
      mutation('tag.create', tagScope, tag({ icon: 'chit-fund-outline' })),
    );

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.upsert).not.toHaveBeenCalled();
  });

  it('carries a tag into the picker it belongs in', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service(), OWNER);

    await session.apply(mutation('tag.create', tagScope, tag({ axis: 'income' })));

    expect(scoped.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ axis: 'income' }),
      expect.anything(),
    );
  });

  it('reads an unknown axis as the one every older tag already had', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service(), OWNER);

    await session.apply(mutation('tag.create', tagScope, tag({ axis: 'sideways' })));

    expect(scoped.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ axis: 'expense' }),
      expect.anything(),
    );
  });
});

describe('installing a pack', () => {
  it('records the install once the pack is found', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(
      mutation('pack.install', packScope, { installId: INSTALL_ID, packId: PACK_ID, version: 2 }),
    );

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: INSTALL_ID,
        owner_user_id: OWNER,
        pack_id: PACK_ID,
        version: 2,
        deleted_at: null,
      }),
      expect.anything(),
    );
  });

  it('refuses a pack it cannot see', async () => {
    // Which is what a draft or an unlisted pack looks like through RLS.
    const scoped = caller({ pack: null });
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(
      mutation('pack.install', packScope, { installId: INSTALL_ID, packId: PACK_ID }),
    );

    expect(outcome).toMatchObject({ status: 'rejected', code: 'NO_SUCH_PACK' });
    expect(scoped.upsert).not.toHaveBeenCalled();
  });

  it('refuses an install written into somebody else’s scope', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(
      mutation('pack.install', 'someone-else:pack_installs', {
        installId: INSTALL_ID,
        packId: PACK_ID,
      }),
    );

    expect(outcome).toMatchObject({ status: 'rejected', code: 'NOT_OWNER' });
    expect(scoped.upsert).not.toHaveBeenCalled();
  });

  it('uninstalls without touching a single category', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service(), OWNER);

    const outcome = await session.apply(
      mutation('pack.uninstall', packScope, { installId: INSTALL_ID }),
    );

    expect(outcome).toMatchObject({ status: 'applied' });
    // A soft delete of the install row, and nothing else written at all.
    expect(scoped.update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }),
    );
    expect(scoped.from).not.toHaveBeenCalledWith('category_tags');
  });
});
