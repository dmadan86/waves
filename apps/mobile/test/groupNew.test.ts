/** Which expenses are new or edited by someone else since the last look. */

import { describe, expect, it } from 'vitest';

import { newMarksSince, type NewLogRow } from '@/lib/groupNew';

const ME = 'm-me';
const isMine = (id: string) => id === ME;

function row(verb: string, by: string | null, at: number, id = 'e1', type = 'expense'): NewLogRow {
  return {
    verb,
    object_type: type,
    object_id: id,
    actor_member_id: by,
    created_at: new Date(at).toISOString(),
  };
}

describe('newMarksSince', () => {
  it('marks an expense someone else added after the last look', () => {
    const marks = newMarksSince([row('added', 'm-ravi', 2_000)], isMine, 1_000);
    expect(marks.get('e1')).toEqual({ kind: 'new', byMemberId: 'm-ravi', at: 2_000 });
  });

  it('marks an expense someone else edited as edited, by the latest editor', () => {
    const marks = newMarksSince(
      [row('edited', 'm-ravi', 2_000), row('edited', 'm-asha', 3_000)],
      isMine,
      1_000,
    );
    expect(marks.get('e1')).toEqual({ kind: 'edited', byMemberId: 'm-asha', at: 3_000 });
  });

  it('keeps a new expense new when it was edited afterwards', () => {
    const marks = newMarksSince(
      [row('added', 'm-ravi', 2_000), row('edited', 'm-ravi', 3_000)],
      isMine,
      1_000,
    );
    expect(marks.get('e1')?.kind).toBe('new');
  });

  it("leaves the reader's own changes out", () => {
    const rows = [row('added', ME, 2_000), row('edited', ME, 3_000, 'e2')];
    expect(newMarksSince(rows, isMine, 1_000).size).toBe(0);
  });

  it('still marks an expense others added that the reader later edited', () => {
    const rows = [row('added', 'm-ravi', 2_000), row('edited', ME, 3_000)];
    expect(newMarksSince(rows, isMine, 1_000).get('e1')?.kind).toBe('new');
  });

  it('marks nothing when the last look is null or unknown', () => {
    const rows = [row('added', 'm-ravi', 2_000)];
    expect(newMarksSince(rows, isMine, null).size).toBe(0);
    expect(newMarksSince(rows, isMine, undefined).size).toBe(0);
  });

  it('treats a row at exactly the last look as seen', () => {
    expect(newMarksSince([row('added', 'm-ravi', 1_000)], isMine, 1_000).size).toBe(0);
    expect(newMarksSince([row('added', 'm-ravi', 1_001)], isMine, 1_000).size).toBe(1);
  });

  it('ignores rows that are not about an expense or not a create or edit', () => {
    const rows = [
      row('settled', 'm-ravi', 2_000, 's1', 'settlement'),
      row('deleted', 'm-ravi', 2_000),
      { ...row('added', 'm-ravi', 0), created_at: 'not a date' },
    ];
    expect(newMarksSince(rows, isMine, 1_000).size).toBe(0);
  });

  it('counts a system row (no actor) as someone else', () => {
    expect(newMarksSince([row('added', null, 2_000)], isMine, 1_000).get('e1')?.kind).toBe('new');
  });
});
