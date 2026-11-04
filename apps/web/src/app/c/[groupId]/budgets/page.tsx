'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { materialiseCompanyProjects, MutationKind } from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { ErrorLine, Page, toMinor, useAction, useMoney } from '@/components/company/Bits';
import { useStrings } from '@/i18n-context';
import { usePoolBalance } from '@/lib/company/pool';
import {
  memberName,
  todayIso,
  useCompanyView,
  type CompanyMember,
  type CompanyView,
} from '@/lib/company/view';
import { NO_QUEUE, useSync } from '@/lib/sync';

export default function CompanyBudgetsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Budgets groupId={groupId} />
    </CompanyFrame>
  );
}

function ManagerRow({
  groupId,
  view,
  manager,
  version,
  onGiven,
}: {
  groupId: string;
  view: CompanyView;
  manager: CompanyMember;
  version: number;
  onGiven: () => void;
}) {
  const { t } = useStrings();
  const b = t.company.budgets;
  const fmt = useMoney(view.currency);
  const { mutate } = useSync();
  const action = useAction('web.company.giveBudget');
  const balance = usePoolBalance(groupId, view, manager.id, version);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const give = (): Promise<boolean> =>
    action.run(async () => {
      const minor = toMinor(amount, view.currency);
      if (minor <= 0n) throw new Error('amount');
      await mutate(MutationKind.CompanyPoolPost, groupId, {
        entryId: crypto.randomUUID(),
        managerId: manager.id,
        kind: 'allocation',
        amountMinor: minor.toString(),
        projectId: null,
        occurredOn: todayIso(),
        reason: note.trim() || null,
      });
      setAmount('');
      setNote('');
      setOpen(false);
      onGiven();
    });

  return (
    <div>
      <div className="item">
        <span className="grow">
          <span className="title">{memberName(manager, t.company.common.someone)}</span>
          <span className="meta">
            {b.balance}: {fmt(balance ?? 0n)}
          </span>
        </span>
        {view.suspended ? null : (
          <button type="button" className="btn soft" onClick={() => setOpen((o) => !o)}>
            {b.give}
          </button>
        )}
      </div>
      {open ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void give();
          }}
        >
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={b.giveAmount}
            aria-label={b.giveAmount}
          />{' '}
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={b.giveNote}
            aria-label={b.giveNote}
            maxLength={500}
          />{' '}
          <button type="submit" className="btn brand" disabled={action.busy || !amount}>
            {b.giveSave}
          </button>
          <ErrorLine message={action.error} />
        </form>
      ) : null}
    </div>
  );
}

function Budgets({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const b = t.company.budgets;
  const view = useCompanyView(groupId);
  const fmt = useMoney(view.currency);
  const { mirror, mutate } = useSync();
  const site = useAction('web.company.site');
  const [version, setVersion] = useState(0);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');

  const sites = useMemo(
    () => materialiseCompanyProjects(mirror, NO_QUEUE, { groupId }).filter((p) => !p.deleted_at),
    [mirror, groupId],
  );

  if (!view.isOwner)
    return (
      <Page title={b.title}>
        <p>{t.company.common.ownersOnly}</p>
      </Page>
    );

  const live = view.members.filter((m) => !m.left_at);
  const managers = live.filter((m) => m.role === 'manager');
  const requests = view.entries
    .filter((e) => e.kind === 'pool_request' && !e.deleted)
    .sort((a, c) => c.occurredOn.localeCompare(a.occurredOn));
  const active = sites.filter((s) => !s.archived_at);

  const saveSite = (
    projectId: string,
    siteName: string,
    budgetMinor: string | null,
    archived: boolean,
  ): Promise<boolean> =>
    site.run(async () => {
      await mutate(MutationKind.CompanyProjectSet, groupId, {
        projectId,
        name: siteName.trim(),
        budgetMinor,
        archived,
      });
    });

  return (
    <Page title={b.title}>
      <section className="panel">
        <h2>{b.sites}</h2>
        {active.map((s) => (
          <div key={s.id} className="item">
            <span className="grow">
              <span className="title">{s.name}</span>
              {s.budget_minor ? <span className="meta">{fmt(BigInt(s.budget_minor))}</span> : null}
            </span>
            {view.suspended ? null : (
              <button
                type="button"
                className="btn soft"
                disabled={site.busy}
                onClick={() => void saveSite(s.id, s.name, s.budget_minor, true)}
              >
                {b.archive}
              </button>
            )}
          </div>
        ))}
        {view.suspended ? null : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const minor = budget ? toMinor(budget, view.currency) : 0n;
              void saveSite(
                crypto.randomUUID(),
                name,
                minor > 0n ? minor.toString() : null,
                false,
              ).then((ok) => {
                if (ok) {
                  setName('');
                  setBudget('');
                }
              });
            }}
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={b.siteName}
              aria-label={b.siteName}
              maxLength={80}
            />{' '}
            <input
              type="number"
              min="0"
              step="any"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder={b.siteBudget}
              aria-label={b.siteBudget}
            />{' '}
            <button type="submit" className="btn brand" disabled={site.busy || !name.trim()}>
              {b.addSite}
            </button>
            <ErrorLine message={site.error} />
          </form>
        )}
      </section>

      <section className="panel">
        <h2>{b.managers}</h2>
        {managers.length === 0 ? (
          <>
            <strong>{b.none}</strong>
            <p className="faint">{b.noneBody}</p>
          </>
        ) : null}
        {managers.map((m) => (
          <ManagerRow
            key={m.id}
            groupId={groupId}
            view={view}
            manager={m}
            version={version}
            onGiven={() => setVersion((n) => n + 1)}
          />
        ))}
      </section>

      {requests.length > 0 ? (
        <section className="panel">
          <h2>{b.requests}</h2>
          {requests.map((r) => (
            <div key={r.id} className="item">
              <span className="grow">
                <span className="title">
                  {memberName(
                    live.find((m) => m.id === r.memberId),
                    t.company.common.someone,
                  )}
                </span>
                {r.note ? <span className="meta">{r.note}</span> : null}
              </span>
              <span>{fmt(r.amount)}</span>
            </div>
          ))}
        </section>
      ) : null}
    </Page>
  );
}
