'use client';

/** What opening a company shows, by role. The server's RLS already limits the rows; this picks the screen. */

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { companyStatement, dashboardStats, MutationKind, poolBalance } from '@waves/core';

import { ActivityRows } from '@/components/company/Activity';
import { LeaveBalanceCard } from '@/components/company/LeaveBalances';
import { EntryRow, ErrorLine, Page, toMinor, useAction, useMoney } from '@/components/company/Bits';
import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { useCompanyActivity } from '@/lib/company/activityHook';
import { usePoolBalance } from '@/lib/company/pool';
import { awaitingApprovals, memberName, todayIso, useCompanyView } from '@/lib/company/view';
import { useSync } from '@/lib/sync';

export function CompanyHome({ groupId }: { groupId: string }) {
  const view = useCompanyView(groupId);
  const { t } = useStrings();
  if (view.isVendor) {
    return (
      <Page title={view.name}>
        <p>{t.company.home.vendorHome}</p>
      </Page>
    );
  }
  if (view.isOwner) return <AdminHome groupId={groupId} />;
  if (view.isManager) return <AdminHome groupId={groupId} manager />;
  return <EmployeeHome groupId={groupId} />;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-cell">
      <div className="faint">{label}</div>
      <strong>{value}</strong>
    </div>
  );
}

function Recent({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const { events } = useCompanyActivity(groupId);
  if (events.length === 0) return null;
  return (
    <section className="panel">
      <div className="page-head">
        <h2>{t.company.home.recentActivity}</h2>
        <Link className="btn soft" href={`/c/${groupId}/activity`}>
          {t.company.home.viewAll}
        </Link>
      </div>
      <ActivityRows groupId={groupId} events={events.slice(0, 5)} />
    </section>
  );
}

/** Owner: the whole company. Manager: the team and the budget. */
function AdminHome({ groupId, manager = false }: { groupId: string; manager?: boolean }) {
  const { t } = useStrings();
  const h = t.company.home;
  const view = useCompanyView(groupId);
  const fmt = useMoney(view.currency);
  const { mutate } = useSync();
  const ask = useAction('web.company.askBudget');
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState('');
  const [version, setVersion] = useState(0);

  const me = view.me;
  const team = view.members.filter((m) => !m.left_at && m.id !== me?.id && m.role === 'member');
  const stats = useMemo(
    () =>
      dashboardStats(
        view.entries,
        team.map((m) => m.id),
        todayIso(),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.entries, view.members],
  );
  const left = usePoolBalance(groupId, view, manager ? (me?.id ?? null) : null, version);
  const pool = useMemo(
    () => (manager && me ? poolBalance(view.entries, me.id) : null),
    [manager, view.entries, me],
  );
  const given = pool ? pool.advances + pool.reimbursed + pool.wages + pool.companySpend : 0n;
  const budget = pool ? pool.allocated + pool.adjusted - pool.returned : 0n;
  const awaiting = awaitingApprovals(view);

  const sendAsk = (): Promise<boolean> =>
    ask.run(async () => {
      if (!me) return;
      const minor = toMinor(amount, view.currency);
      if (minor <= 0n) throw new Error('amount');
      await mutate(MutationKind.CompanyPoolPost, groupId, {
        entryId: crypto.randomUUID(),
        managerId: me.id,
        kind: 'pool_request',
        amountMinor: minor.toString(),
        projectId: null,
        occurredOn: todayIso(),
        reason: null,
      });
      setAmount('');
      setAsking(false);
      setVersion((n) => n + 1);
    });

  return (
    <Page
      title={view.name}
      actions={
        view.suspended ? null : (
          <Link className="btn brand" href={`/c/${groupId}/entry/new`}>
            {h.addEntry}
          </Link>
        )
      }
    >
      {manager ? (
        <section className="panel">
          <h2>{h.yourBudget}</h2>
          <strong>{fmt(budget)}</strong>
          <p className="faint">
            {h.givenOut}: {fmt(given)} · {h.budgetLeft}: {fmt(left ?? 0n)}
          </p>
          {asking ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendAsk();
              }}
            >
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label={h.amount}
                placeholder={h.amount}
              />{' '}
              <button type="submit" className="btn brand" disabled={ask.busy || !amount}>
                {h.askBudgetSend}
              </button>
              <ErrorLine message={ask.error} />
            </form>
          ) : (
            <button type="button" className="btn soft" onClick={() => setAsking(true)}>
              {h.askBudget}
            </button>
          )}
        </section>
      ) : null}

      <div className="stat-strip">
        <Tile label={h.owesYou} value={fmt(stats.owes)} />
        <Tile label={h.pendingClaims} value={String(awaiting.length)} />
        <Tile label={t.company.nav.payments} value={fmt(stats.paidThisMonth)} />
        <Tile label={h.employeesCount} value={String(team.length)} />
      </div>

      {awaiting.length > 0 ? (
        <section className="panel">
          <div className="page-head">
            <h2>{t.company.pending.approvals}</h2>
            <Link className="btn soft" href={`/c/${groupId}/pending`}>
              {h.viewAll}
            </Link>
          </div>
          {awaiting.slice(0, 3).map((entry) => (
            <EntryRow key={entry.id} view={view} entry={entry} groupId={groupId} />
          ))}
        </section>
      ) : null}

      {manager && team.length > 0 ? (
        <section className="panel">
          <h2>{h.teamTitle}</h2>
          {team.slice(0, 6).map((m) => (
            <Link key={m.id} href={`/c/${groupId}/statement/${m.id}`} className="item">
              <span className="grow">
                <span className="title">{memberName(m, t.company.common.someone)}</span>
                {m.employee_id ? <span className="meta">{m.employee_id}</span> : null}
              </span>
            </Link>
          ))}
        </section>
      ) : null}

      <Recent groupId={groupId} />
    </Page>
  );
}

function EmployeeHome({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const h = t.company.home;
  const view = useCompanyView(groupId);
  const fmt = useMoney(view.currency);
  const me = view.me;
  const boss =
    view.directory.find((p) => p.member_id === me?.manager_id) ??
    view.directory.find((p) => p.role === 'admin');
  const month = todayIso().slice(0, 7);

  const sums = useMemo(() => {
    const mine = view.entries.filter(
      (e) => !e.paidByCompany && e.memberId === me?.id && !e.deleted,
    );
    const st = me
      ? companyStatement(view.entries, { memberId: me.id, from: '0000-01-01', to: '9999-12-31' })
      : null;
    return {
      advances: st?.totals.advances ?? 0n,
      spent: (st?.totals.expenses ?? 0n) + (st?.totals.allowance ?? 0n),
      wages: mine
        .filter(
          (e) =>
            (e.kind === 'wage_payment' || e.kind === 'wages') && e.occurredOn.startsWith(month),
        )
        .reduce((sum, e) => sum + e.amount, 0n),
      list: mine.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)),
    };
  }, [view.entries, me, month]);

  return (
    <Page
      title={view.name}
      actions={
        view.suspended ? null : (
          <Link className="btn brand" href={`/c/${groupId}/entry/new`}>
            {h.addEntry}
          </Link>
        )
      }
    >
      <p className="faint">
        {boss ? fill(h.yourManager, { name: boss.display_name }) : h.yourOwners}
      </p>
      <div className="stat-strip">
        <Tile label={h.advances} value={fmt(sums.advances)} />
        <Tile label={h.spent} value={fmt(sums.spent)} />
        <Tile label={h.wagesThisMonth} value={fmt(sums.wages)} />
      </div>
      <LeaveBalanceCard groupId={groupId} memberId={me?.id ?? null} />
      <section className="panel">
        <div className="page-head">
          <h2>{h.yourEntries}</h2>
          {me ? (
            <Link className="btn soft" href={`/c/${groupId}/statement/${me.id}`}>
              {t.company.more.activity}
            </Link>
          ) : null}
        </div>
        {sums.list.length === 0 ? <p>{h.welcomeEmployee}</p> : null}
        {sums.list.map((entry) => (
          <EntryRow key={entry.id} view={view} entry={entry} groupId={groupId} />
        ))}
      </section>
    </Page>
  );
}
