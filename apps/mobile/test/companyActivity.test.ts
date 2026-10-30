import { describe, expect, it } from 'vitest';
import type { CompanyEntry } from '@waves/core';

import {
  buildCompanyActivity,
  groupByDay,
  hasNewActivity,
  type ActivityInput,
  type ActivityRole,
} from '../src/lib/companyActivity';

const entry = (o: Partial<CompanyEntry>): CompanyEntry =>
  ({
    id: 'e1',
    groupId: 'g',
    memberId: 'rohit',
    paidByCompany: false,
    kind: 'expense',
    amount: 5000n,
    currency: 'INR',
    status: 'approved',
    createdAt: '2026-10-30T08:00:00Z',
    createdBy: 'rohit',
    deleted: false,
    direction: null,
    ...o,
  }) as CompanyEntry;

function input(
  role: ActivityRole,
  me: string | null,
  o: Partial<ActivityInput> = {},
): ActivityInput {
  return {
    viewer: { memberId: me, role, manageableIds: new Set(['rohit', 'kavita']), active: true },
    labels: { you: 'You', youObj: 'you', someone: 'Someone' },
    names: new Map([
      ['owner', 'Sanjay'],
      ['rohit', 'Rohit'],
      ['kavita', 'Kavita'],
      ['other', 'Other'],
      ['mgr', 'Mani'],
    ]),
    entries: [],
    entryReviews: new Map(),
    attendance: [],
    tasks: [],
    members: [],
    vendors: [],
    vendorLines: [],
    vendorReviews: new Map(),
    docs: [],
    ...o,
  };
}

const mark = (memberId: string, at: string, status: 'present' | 'half' | 'absent' = 'present') => ({
  memberId,
  day: '2026-10-30',
  status,
  markedBy: 'owner',
  updatedAt: at,
});

describe('buildCompanyActivity', () => {
  it('orders newest first and gives each event a sentence key', () => {
    const ev = buildCompanyActivity(
      input('owner', 'owner', {
        entries: [
          entry({ id: 'a', createdAt: '2026-10-30T08:00:00Z' }),
          entry({
            id: 'b',
            createdAt: '2026-10-30T09:00:00Z',
            kind: 'advance',
            createdBy: 'owner',
          }),
        ],
      }),
    );
    expect(ev.map((e) => e.id)).toEqual(['e:b', 'e:a']);
    expect(ev[0]).toMatchObject({ text: 'advance', vars: { actor: 'You', name: 'Rohit' } });
    expect(ev[1]).toMatchObject({ text: 'expense', byMe: false });
  });

  it('collapses one marking session into a single row and splits by person and gap', () => {
    const ev = buildCompanyActivity(
      input('owner', 'owner', {
        attendance: [
          mark('rohit', '2026-10-30T04:44:00Z'),
          mark('kavita', '2026-10-30T04:44:30Z'),
          mark('other', '2026-10-30T04:45:00Z'),
          mark('rohit', '2026-10-30T09:00:00Z', 'absent'),
        ],
      }),
    );
    const att = ev.filter((e) => e.group === 'attendance');
    expect(att).toHaveLength(2);
    expect(att[0]).toMatchObject({
      text: 'attendanceOne',
      vars: { status: 'absent', name: 'Rohit' },
    });
    expect(att[1]).toMatchObject({ text: 'attendanceMany', vars: { count: 3, status: 'present' } });
    expect(att[1]!.href).toBe('company-attendance?date=2026-10-30');
  });

  it('shows a manager only their team, own documents and own company payments', () => {
    const ev = buildCompanyActivity(
      input('manager', 'mgr', {
        viewer: {
          memberId: 'mgr',
          role: 'manager',
          manageableIds: new Set(['rohit']),
          active: true,
        },
        entries: [
          entry({ id: 'team', memberId: 'rohit' }),
          entry({ id: 'far', memberId: 'other', createdBy: 'other' }),
          entry({ id: 'co', paidByCompany: true, memberId: '', createdBy: 'owner' }),
        ],
        attendance: [mark('rohit', '2026-10-30T05:00:00Z'), mark('other', '2026-10-30T06:00:00Z')],
      }),
    );
    expect(ev.map((e) => e.id).sort()).toEqual([
      'a:owner:present:' + Date.parse('2026-10-30T05:00:00Z'),
      'e:team',
    ]);
  });

  it('shows an employee only what is about them, and a vendor or departed viewer nothing', () => {
    const base = {
      entries: [
        entry({ id: 'mine' }),
        entry({ id: 'theirs', memberId: 'kavita', createdBy: 'kavita' }),
      ],
      attendance: [mark('rohit', '2026-10-30T05:00:00Z'), mark('kavita', '2026-10-30T05:00:00Z')],
      members: [
        {
          id: 'kavita',
          role: 'member',
          hasProfile: true,
          createdAt: '2026-10-01T00:00:00Z',
          leftAt: null,
          removedBy: null,
        },
      ],
    };
    const emp = buildCompanyActivity(input('employee', 'rohit', base));
    expect(emp.every((e) => !e.id.includes('theirs') && !e.id.startsWith('p:'))).toBe(true);
    expect(emp.map((e) => e.group).sort()).toEqual(['attendance', 'money']);
    expect(buildCompanyActivity(input('vendor', 'v', base))).toEqual([]);
    const gone = input('owner', 'owner', base);
    expect(buildCompanyActivity({ ...gone, viewer: { ...gone.viewer, active: false } })).toEqual(
      [],
    );
  });

  it('adds an approval only when a different person reviewed it later', () => {
    const e = entry({ id: 'c', status: 'approved' });
    const ev = buildCompanyActivity(
      input('owner', 'owner', {
        entries: [e],
        entryReviews: new Map([['c', { at: '2026-10-30T10:00:00Z', by: 'owner' }]]),
      }),
    );
    expect(ev.map((x) => x.text)).toEqual(['approved', 'expense']);
    const same = buildCompanyActivity(
      input('owner', 'owner', {
        entries: [e],
        entryReviews: new Map([['c', { at: '2026-10-30T08:00:01Z', by: 'owner' }]]),
      }),
    );
    expect(same.map((x) => x.text)).toEqual(['expense']);
  });

  it('keeps vendors to the manager who added them', () => {
    const vendors = [
      { id: 'v1', name: 'Mehta', addedBy: 'mgr', deleted: false },
      { id: 'v2', name: 'Shah', addedBy: 'owner', deleted: false },
    ] as never;
    const line = (id: string, vendorId: string) =>
      ({
        id,
        vendorId,
        kind: 'bill',
        status: 'pending',
        amount: 100n,
        createdBy: 'mgr',
        createdAt: '2026-10-30T07:00:00Z',
        receivedAt: null,
        deleted: false,
      }) as never;
    const ev = buildCompanyActivity(
      input('manager', 'mgr', { vendors, vendorLines: [line('l1', 'v1'), line('l2', 'v2')] }),
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ text: 'vendorBillPending', href: 'company-vendor?vendorId=v1' });
  });
});

describe('feed helpers', () => {
  it('groups by local day and lights the bell only for others after the last look', () => {
    const ev = buildCompanyActivity(
      input('owner', 'owner', {
        entries: [
          entry({ id: 'x', createdAt: '2026-10-30T09:00:00Z' }),
          entry({ id: 'y', createdAt: '2026-10-20T09:00:00Z', createdBy: 'owner' }),
        ],
      }),
    );
    expect(groupByDay(ev)).toHaveLength(2);
    expect(hasNewActivity(ev, null)).toBe(false);
    expect(hasNewActivity(ev, Date.parse('2026-10-30T08:00:00Z'))).toBe(true);
    expect(hasNewActivity(ev, Date.parse('2026-10-30T10:00:00Z'))).toBe(false);
    expect(
      hasNewActivity(
        ev.filter((e) => e.byMe),
        0,
      ),
    ).toBe(false);
  });
});

describe('restamp and session guards', () => {
  it('does not let a re-stamped old mark or paid-bill edit pose as news, and keeps days apart', () => {
    const ev = buildCompanyActivity(
      input('owner', 'owner', {
        attendance: [
          { ...mark('rohit', '2026-10-30T05:00:00Z'), day: '2026-08-01' },
          { ...mark('rohit', '2026-10-30T05:01:00Z'), day: '2026-10-29' },
          { ...mark('rohit', '2026-10-30T05:02:00Z'), day: '2026-10-30' },
        ],
      }),
    );
    expect(ev.filter((e) => e.group === 'attendance')).toHaveLength(2);
  });
});
