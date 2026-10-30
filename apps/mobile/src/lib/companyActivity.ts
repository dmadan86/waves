/**
 * The company activity feed: what happened in this company, newest first, built on the phone from
 * rows it already holds (nothing new is stored or fetched). Pure: names and roles come in, plain
 * `{ text key, vars }` events come out, and the screen turns a key into a sentence in the reader's
 * language.
 *
 * Privacy is the viewer's own reach, applied again here even though the server already filters:
 * owner everything; manager their team, their own vendors and their own documents; employee only
 * what is about them; a vendor login or someone who has left gets nothing. An event carries an
 * amount only when its row survived those filters.
 */

import type { Ionicons } from '@expo/vector-icons';
import {
  docNumberLabel,
  type CompanyEntry,
  type MirrorCompanyDoc,
  type Vendor,
  type VendorLine,
} from '@waves/core';

export type ActivityGroup = 'money' | 'attendance' | 'tasks' | 'people' | 'vendors';

export type ActivityText =
  | 'expense'
  | 'expenseFor'
  | 'allowance'
  | 'allowanceFor'
  | 'advance'
  | 'wages'
  | 'reimbursed'
  | 'cashReturned'
  | 'companyPaid'
  | 'approved'
  | 'rejected'
  | 'attendanceOne'
  | 'attendanceMany'
  | 'taskAssigned'
  | 'taskDone'
  | 'taskBlocked'
  | 'joined'
  | 'joinedManager'
  | 'added'
  | 'markedNotEmployed'
  | 'left'
  | 'vendorBill'
  | 'vendorBillPending'
  | 'vendorBillRejected'
  | 'vendorPayment'
  | 'vendorAdvance'
  | 'vendorReceived'
  | 'estimateCreated'
  | 'billCreated'
  | 'billPaid';

export interface CompanyActivityEvent {
  readonly id: string;
  /** ms since epoch. */
  readonly at: number;
  readonly group: ActivityGroup;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly text: ActivityText;
  readonly vars: Readonly<Record<string, string | number>>;
  readonly amount: { readonly minor: bigint; readonly currency: string } | null;
  /** A route under `/group/<id>/`. */
  readonly href: string;
  /** The viewer did it themself: it never lights the bell. */
  readonly byMe: boolean;
}

export type ActivityRole = 'owner' | 'manager' | 'employee' | 'vendor';

export interface ActivityInput {
  readonly viewer: {
    readonly memberId: string | null;
    readonly role: ActivityRole;
    /** Whom a manager answers for (an owner: everyone). */
    readonly manageableIds: ReadonlySet<string>;
    /** False once the viewer has left or is not employed: nothing new reaches them. */
    readonly active: boolean;
  };
  /** Words for "me" as the doer / the object, and for a name nobody can see. */
  readonly labels: { readonly you: string; readonly youObj: string; readonly someone: string };
  readonly names: ReadonlyMap<string, string>;
  readonly entries: readonly CompanyEntry[];
  /** entry id -> who reviewed it and when (ISO). */
  readonly entryReviews: ReadonlyMap<string, { at: string; by: string }>;
  readonly attendance: readonly {
    readonly memberId: string;
    readonly day: string;
    readonly status: 'present' | 'half' | 'absent';
    readonly markedBy: string;
    readonly updatedAt: string;
  }[];
  readonly tasks: readonly {
    readonly id: string;
    readonly memberId: string;
    readonly title: string;
    readonly status: string;
    readonly createdBy: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  }[];
  readonly members: readonly {
    readonly id: string;
    readonly role: string;
    readonly hasProfile: boolean;
    readonly createdAt: string;
    readonly leftAt: string | null;
    readonly removedBy: string | null;
  }[];
  readonly vendors: readonly Vendor[];
  readonly vendorLines: readonly VendorLine[];
  readonly vendorReviews: ReadonlyMap<string, string>;
  readonly docs: readonly {
    readonly doc: MirrorCompanyDoc;
    readonly createdAt: string;
    readonly updatedAt: string;
  }[];
}

const POOL_KINDS = new Set(['allocation', 'pool_return', 'pool_adjustment', 'pool_request']);
/** Two stamps this close are one act (a row created and settled in the same save). */
const SAME_ACT_MS = 2000;
/** Marks by one person closer together than this are one marking session. */
const SESSION_GAP_MS = 5 * 60 * 1000;

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

export function buildCompanyActivity(input: ActivityInput): CompanyActivityEvent[] {
  const { viewer, labels } = input;
  if (!viewer.active || viewer.role === 'vendor') return [];
  const me = viewer.memberId;
  const owner = viewer.role === 'owner';
  const manager = viewer.role === 'manager';
  /** A person's rows are the viewer's to see. */
  const sees = (memberId: string): boolean =>
    owner
      ? true
      : memberId === me || (manager && viewer.manageableIds.has(memberId) && memberId !== '');
  const who = (id: string | null | undefined): string =>
    id && id === me ? labels.you : (id && input.names.get(id)) || labels.someone;
  const whom = (id: string | null | undefined): string =>
    id && id === me ? labels.youObj : (id && input.names.get(id)) || labels.someone;

  const out: CompanyActivityEvent[] = [];
  const push = (e: Omit<CompanyActivityEvent, 'byMe'> & { actor: string | null }): void => {
    if (!Number.isFinite(e.at)) return;
    const { actor, ...rest } = e;
    out.push({ ...rest, byMe: actor !== null && actor === me });
  };

  // Money.
  for (const e of input.entries) {
    if (e.deleted || POOL_KINDS.has(e.kind)) continue;
    if (e.paidByCompany ? !(owner || (manager && e.createdBy === me)) : !sees(e.memberId)) continue;
    // A manager sees their own team's entries and the ones they made; an employee only their own.
    const actor = e.createdBy;
    const self = actor === e.memberId;
    const money = { minor: e.amount, currency: e.currency };
    const base = {
      group: 'money' as const,
      amount: money,
      href: `company-entry-view?entry=${e.id}`,
      actor,
    };
    const vars = { actor: who(actor), name: whom(e.memberId) };
    let text: ActivityText;
    if (e.paidByCompany) text = 'companyPaid';
    else if (e.kind === 'expense') text = self ? 'expense' : 'expenseFor';
    else if (e.kind === 'allowance') text = self ? 'allowance' : 'allowanceFor';
    else if (e.kind === 'advance') text = 'advance';
    else if (e.kind === 'wages' || e.kind === 'wage_payment') text = 'wages';
    else text = e.direction === 'employee_to_company' ? 'cashReturned' : 'reimbursed';
    push({
      ...base,
      id: `e:${e.id}`,
      at: ms(e.createdAt),
      icon: e.kind === 'advance' ? 'arrow-up-circle-outline' : 'wallet-outline',
      text,
      vars,
    });
    const review = input.entryReviews.get(e.id);
    if (
      review &&
      !e.paidByCompany &&
      review.by !== actor &&
      ms(review.at) - ms(e.createdAt) > SAME_ACT_MS &&
      (e.status === 'rejected' || e.status === 'approved' || e.status === 'reimbursed')
    ) {
      const rejected = e.status === 'rejected';
      push({
        ...base,
        id: `r:${e.id}`,
        at: ms(review.at),
        icon: rejected ? 'close-circle-outline' : 'checkmark-circle-outline',
        text: rejected ? 'rejected' : 'approved',
        vars: { actor: who(review.by), name: whom(e.memberId) },
        actor: review.by,
      });
    }
  }

  // Attendance: one row per marking session (same person, same mark, marks minutes apart).
  const marks = input.attendance
    .filter((a) => sees(a.memberId) && Number.isFinite(ms(a.updatedAt)))
    .map((a) => ({ ...a, t: ms(a.updatedAt) }))
    .sort((a, b) =>
      a.markedBy === b.markedBy
        ? a.status === b.status
          ? a.t - b.t
          : a.status.localeCompare(b.status)
        : a.markedBy.localeCompare(b.markedBy),
    );
  let session: typeof marks = [];
  const flush = (): void => {
    if (session.length === 0) return;
    const first = session[0]!;
    const last = session[session.length - 1]!;
    const many = new Set(session.map((s) => s.memberId)).size > 1;
    push({
      id: `a:${first.markedBy}:${first.status}:${first.t}`,
      at: last.t,
      group: 'attendance',
      icon: first.status === 'absent' ? 'close-circle-outline' : 'checkmark-done-outline',
      text: many ? 'attendanceMany' : 'attendanceOne',
      vars: {
        actor: who(first.markedBy),
        name: whom(first.memberId),
        count: new Set(session.map((s) => s.memberId)).size,
        status: first.status,
      },
      amount: null,
      href: `company-attendance?date=${last.day}`,
      actor: first.markedBy,
    });
    session = [];
  };
  for (const m of marks) {
    const prev = session[session.length - 1];
    if (
      prev &&
      (prev.markedBy !== m.markedBy || prev.status !== m.status || m.t - prev.t > SESSION_GAP_MS)
    )
      flush();
    session.push(m);
  }
  flush();

  // Daily work.
  for (const k of input.tasks) {
    if (!sees(k.memberId)) continue;
    const vars = { title: k.title, name: whom(k.memberId) };
    const base = { group: 'tasks' as const, amount: null, href: 'company-work' };
    push({
      ...base,
      id: `t:${k.id}`,
      at: ms(k.createdAt),
      icon: 'clipboard-outline',
      text: 'taskAssigned',
      vars,
      actor: k.createdBy,
    });
    if (
      (k.status === 'done' || k.status === 'blocked') &&
      ms(k.updatedAt) - ms(k.createdAt) > SAME_ACT_MS
    )
      push({
        ...base,
        id: `t2:${k.id}:${k.status}`,
        at: ms(k.updatedAt),
        icon: k.status === 'done' ? 'checkmark-circle-outline' : 'alert-circle-outline',
        text: k.status === 'done' ? 'taskDone' : 'taskBlocked',
        vars,
        // Who moved it on is not recorded; the person it is for is the natural subject.
        actor: null,
      });
  }

  // People: only for someone who manages them. An employee or manager is not told of colleagues.
  if (owner || manager) {
    for (const m of input.members) {
      if (m.role === 'admin' || m.role === 'vendor' || m.id === me || !sees(m.id)) continue;
      const base = {
        group: 'people' as const,
        amount: null,
        href: `company-statement?member=${m.id}`,
        vars: { name: whom(m.id) } as Record<string, string | number>,
      };
      push({
        ...base,
        id: `p:${m.id}`,
        at: ms(m.createdAt),
        icon: 'person-add-outline',
        text: !m.hasProfile ? 'added' : m.role === 'manager' ? 'joinedManager' : 'joined',
        actor: m.id,
      });
      if (m.leftAt) {
        push({
          ...base,
          id: `p2:${m.id}`,
          at: ms(m.leftAt),
          icon: 'person-remove-outline',
          text: m.removedBy ? 'markedNotEmployed' : 'left',
          vars: { actor: who(m.removedBy), name: whom(m.id) },
          actor: m.removedBy,
        });
      }
    }
  }

  // Vendors and their bills: owner all, a manager the vendors they added.
  if (owner || manager) {
    const mine = new Map(
      input.vendors.filter((v) => !v.deleted && (owner || v.addedBy === me)).map((v) => [v.id, v]),
    );
    for (const l of input.vendorLines) {
      const v = mine.get(l.vendorId);
      if (!v || l.deleted) continue;
      const vars = { actor: who(l.createdBy), vendor: v.name };
      const base = {
        group: 'vendors' as const,
        amount: { minor: l.amount, currency: '' },
        href: `company-vendor?vendorId=${v.id}`,
      };
      const text: ActivityText =
        l.kind === 'bill'
          ? l.status === 'pending'
            ? 'vendorBillPending'
            : 'vendorBill'
          : l.kind === 'payment'
            ? 'vendorPayment'
            : 'vendorAdvance';
      push({
        ...base,
        id: `v:${l.id}`,
        at: ms(l.createdAt),
        icon: l.kind === 'bill' ? 'receipt-outline' : 'cash-outline',
        text,
        vars,
        actor: l.createdBy,
      });
      const reviewed = input.vendorReviews.get(l.id);
      if (l.status === 'rejected' && reviewed)
        push({
          ...base,
          id: `v2:${l.id}`,
          at: ms(reviewed),
          icon: 'close-circle-outline',
          text: 'vendorBillRejected',
          vars,
          actor: null,
        });
      if (l.kind === 'payment' && l.receivedAt)
        push({
          ...base,
          id: `v3:${l.id}`,
          at: ms(l.receivedAt),
          icon: 'checkmark-circle-outline',
          text: 'vendorReceived',
          vars,
          actor: null,
        });
    }
  }

  // Estimates and bills: owner all, a manager only the ones they made.
  if (owner || manager) {
    for (const { doc: d, createdAt, updatedAt } of input.docs) {
      if (d.deleted || !(owner || d.createdBy === me)) continue;
      const vars = {
        actor: who(d.createdBy),
        number: docNumberLabel(d.docType, d.number),
        customer: d.customerName,
      };
      const base = {
        group: 'vendors' as const,
        amount: { minor: d.totalMinor, currency: d.currency },
        href: `company-bill?docId=${d.id}`,
      };
      push({
        ...base,
        id: `d:${d.id}`,
        at: ms(createdAt),
        icon: 'document-text-outline',
        text: d.docType === 'estimate' ? 'estimateCreated' : 'billCreated',
        vars,
        actor: d.createdBy,
      });
      if (
        d.docType === 'bill' &&
        d.status === 'paid' &&
        ms(updatedAt) - ms(createdAt) > SAME_ACT_MS
      )
        push({
          ...base,
          id: `d2:${d.id}`,
          at: ms(updatedAt),
          icon: 'checkmark-circle-outline',
          text: 'billPaid',
          vars,
          actor: null,
        });
    }
  }

  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
}

/** Local calendar day of an instant, `YYYY-MM-DD`. */
export function localDay(at: number): string {
  const d = new Date(at);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Events newest first, split into local days. */
export function groupByDay(
  events: readonly CompanyActivityEvent[],
): { day: string; events: CompanyActivityEvent[] }[] {
  const days: { day: string; events: CompanyActivityEvent[] }[] = [];
  for (const e of events) {
    const day = localDay(e.at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.events.push(e);
    else days.push({ day, events: [e] });
  }
  return days;
}

/** Whether the bell wears its dot: somebody else did something after the last look, and the last look is known. */
export function hasNewActivity(
  events: readonly CompanyActivityEvent[],
  seenAt: number | null,
): boolean {
  return seenAt !== null && events.some((e) => !e.byMe && e.at > seenAt);
}
