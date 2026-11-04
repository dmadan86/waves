/**
 * Company two-step in /sync: a company this session has not verified stays in `memberOf` (so the phone keeps it),
 * and every write to it is refused with TWO_STEP_REQUIRED (transient on the phone, so it stays queued).
 */

import { describe, expect, it, vi } from 'vitest';

import { memberships, SyncSession, twoStepBlocked } from './index.ts';

const PROFILE = 'p-1';
const PERSONAL = 'g-personal';
const COMPANY = 'g-company';

function query(data: unknown) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'eq']) builder[m] = vi.fn(() => builder);
  builder.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
  return builder;
}

describe('memberships', () => {
  it('lists a gated company in memberOf although RLS hides it from the caller', async () => {
    // RLS: the caller only sees the personal group; the service read for this profile sees both.
    const callerQuery = query([{ group_id: PERSONAL, role: 'admin' }]);
    const serviceQuery = query([
      { group_id: PERSONAL },
      { group_id: COMPANY },
      { group_id: COMPANY },
    ]);
    const caller = { from: vi.fn(() => callerQuery) };
    const service = { from: vi.fn(() => serviceQuery) };
    const view = await memberships(caller, service, PROFILE);
    expect(view.mine.map((r) => r.group_id)).toEqual([PERSONAL]);
    expect(view.memberOf.sort()).toEqual([COMPANY, PERSONAL].sort());
    // The service read is narrowed to this profile, never the whole table.
    expect(serviceQuery.eq).toHaveBeenCalledWith('profile_id', PROFILE);
  });
});

describe('twoStepBlocked', () => {
  it('names the requiring companies of an unverified session, and none once verified', async () => {
    const status = (sessionVerified: boolean) => ({
      rpc: vi.fn().mockResolvedValue({
        data: { sessionVerified, requiring: [{ groupId: COMPANY, name: 'Acme' }] },
        error: null,
      }),
    });
    expect([...(await twoStepBlocked(status(false)))]).toEqual([[COMPANY, 'Acme']]);
    expect((await twoStepBlocked(status(true))).size).toBe(0);
  });
});

describe('SyncSession and a gated company', () => {
  function session() {
    const service = {
      from: vi.fn(() => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = () => Promise.resolve({ data: null, error: null });
        b.insert = vi.fn(() => Promise.resolve({ error: null }));
        return b;
      }),
    };
    const caller = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }), from: vi.fn() };
    return { s: new SyncSession(caller, service, PROFILE, new Map([[COMPANY, 'Acme']])), caller };
  }

  it('refuses a write with TWO_STEP_REQUIRED and the company name, without touching the database', async () => {
    const { s, caller } = session();
    const outcome = await s.apply({
      clientMutationId: 'm-1',
      kind: 'company_attendance.set',
      groupId: COMPANY,
      payload: {},
    } as never);
    expect(outcome).toMatchObject({ status: 'rejected', code: 'TWO_STEP_REQUIRED' });
    expect((outcome as { message: string }).message).toContain('Acme');
    expect(caller.rpc).not.toHaveBeenCalled();
    expect(caller.from).not.toHaveBeenCalled();
  });

  it('lets personal writes through untouched', async () => {
    const { s, caller } = session();
    const outcome = await s.apply({
      clientMutationId: 'm-2',
      kind: 'expense.create',
      groupId: PERSONAL,
      payload: {},
    } as never);
    expect((outcome as { code?: string }).code).not.toBe('TWO_STEP_REQUIRED');
    expect(caller.rpc).toHaveBeenCalled();
  });
});
