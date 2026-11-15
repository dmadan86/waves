'use client';

/**
 * Import a bank statement into the private ledger, in the browser.
 *
 *   Free  a spreadsheet or OFX of the five big banks is read here and previewed
 *         (count, total spent, first three rows), then the plan page. Two a month.
 *   Pro   the same file is read here and reviewed; a layout we do not know is
 *         sent to `parse-statement` with account numbers hidden, as on the phone.
 *
 * Nothing is written before "Add": the review is where a person ticks rows and
 * fixes a category or amount (ADR-008). Rows that look already added are
 * unticked, and a confirmed row keeps one stable id, so a second upload cannot
 * double it. PDFs are not read on the web yet.
 */

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import {
  CATEGORIES,
  MutationKind,
  personalScope,
  planStatementImport,
  previewStatement,
  readStatementPages,
  toMajorString,
  type CurrencyCode,
  type StatementItem,
  type StatementPlan,
  type StatementPageInput,
  type StatementRow,
} from '@waves/core';

import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import {
  afterPreview,
  initialTicks,
  PREVIEW_STORAGE_KEY,
  previewsLeft,
  readStatementFile,
  reviewItems,
  statementNote,
  type StatementReadFailure,
} from '@/lib/statementImport';
import {
  existingExpenses,
  guessFor,
  ledgerTxns,
  recordIdFor,
  wordedAsEntries,
  statementEntry,
  type RowEdit,
} from '@/lib/me';
import { callParseStatement } from '@/lib/meCloud';
import { money } from '@/lib/money';
import { usePlan } from '@/lib/plan';
import { useSync } from '@/lib/sync';

type Stage =
  | { name: 'pick' }
  | { name: 'working' }
  | {
      name: 'preview';
      count: number;
      spent: bigint;
      first: StatementRow[];
      left: number;
      currency: string;
    }
  | { name: 'review'; plan: StatementPlan; currency: string }
  | { name: 'saving' }
  | { name: 'done'; added: number };

const randomId = (): string => crypto.randomUUID().replace(/-/g, '');

export function StatementImport({ profileId }: { profileId: string }) {
  const { t, locale } = useStrings();
  const s = t.me.importPage;
  const { isPaid, loading: planLoading } = usePlan();
  const { mirror, mutate } = useSync();
  const [stage, setStage] = useState<Stage>({ name: 'pick' });
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const input = useRef<HTMLInputElement>(null);

  const existing = useMemo(
    () => existingExpenses(ledgerTxns(mirror, profileId)),
    [mirror, profileId],
  );
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const fail = (failure: StatementReadFailure | 'freeUnknown' | 'noPreviews' | 'generic') => {
    setError(s.errors[failure as keyof typeof s.errors] ?? s.errors.generic);
    setStage({ name: 'pick' });
  };

  function showPlan(rows: readonly StatementRow[], currency: string) {
    if (rows.length === 0) return fail('no_transactions');
    const plan = planStatementImport(wordedAsEntries(rows), { currency, existing });
    setTicked(initialTicks(plan));
    setEdits({});
    setStage({ name: 'review', plan, currency });
  }

  async function readWithAi(pages: StatementPageInput[]) {
    const outcome = await readStatementPages({
      pages,
      importId: randomId(),
      hints: { currency: 'INR', today, locale, country: null, bank: null, dateOrder: null },
      call: callParseStatement,
    });
    if (outcome.ok) return showPlan(outcome.rows, outcome.currency ?? 'INR');
    if (outcome.reason === 'paid') {
      setUpgrade(true);
      return fail('freeUnknown');
    }
    const map = {
      quota: 'quota',
      unavailable: 'unavailable',
      rate: 'rate',
      dense: 'dense',
      refused: 'refused',
      expired: 'expired',
    } as const;
    if (outcome.reason === 'quota') setError(fill(s.errors.quota, { limit: 30 }));
    else setError(s.errors[map[outcome.reason as keyof typeof map]] ?? s.errors.generic);
    setStage({ name: 'pick' });
  }

  async function onFile(file: File) {
    setError(null);
    setUpgrade(false);
    setStage({ name: 'working' });
    try {
      const read = await readStatementFile(
        file.name,
        file.type,
        new Uint8Array(await file.arrayBuffer()),
        today,
      );
      if (!read.ok) {
        const unknown = read.failure === 'unknown_layout' || read.failure === 'no_transactions';
        if (unknown && !isPaid) {
          setUpgrade(true);
          return fail('freeUnknown');
        }
        if (unknown && read.pages) return await readWithAi(read.pages);
        return fail(read.failure);
      }
      if (isPaid) return showPlan(read.rows, read.currency);
      // Free: a teaser read in this browser, never sent anywhere.
      const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
      const left = previewsLeft(raw, new Date());
      if (left <= 0) {
        setUpgrade(true);
        return fail('noPreviews');
      }
      localStorage.setItem(PREVIEW_STORAGE_KEY, afterPreview(raw, new Date()));
      const preview = previewStatement(read.rows);
      setUpgrade(true);
      setStage({
        name: 'preview',
        count: preview.count,
        spent: preview.spentMinor,
        first: [...preview.first],
        left: left - 1,
        currency: read.currency,
      });
    } catch {
      fail('generic');
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  const toggle = (key: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const edit = (key: string, patch: RowEdit) =>
    setEdits((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  const label = (category: string | null) =>
    category === null
      ? s.rowCategory
      : ((t.categories as Record<string, string>)[category] ?? category);

  async function confirm(plan: StatementPlan, currency: string) {
    const rows = reviewItems(plan).filter((item) => ticked.has(item.key));
    setStage({ name: 'saving' });
    try {
      for (const item of rows) {
        const data = statementEntry(item, edits[item.key] ?? {}, currency, today);
        if (!data) throw new Error('amount');
        await mutate(MutationKind.PersonalUpsert, personalScope(profileId), {
          recordId: await recordIdFor(profileId, `${currency}:${item.key}`),
          recordKind: 'txn',
          data,
        });
      }
      setStage({ name: 'done', added: rows.length });
    } catch {
      setError(s.errors.saveFailed);
      setStage({ name: 'review', plan, currency });
    }
  }

  const head = (
    <div className="page-head">
      <Link className="btn soft" href="/me">
        {s.back}
      </Link>
      <h1>{s.title}</h1>
    </div>
  );
  const errorBox = error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;

  if (stage.name === 'working' || stage.name === 'saving') {
    return (
      <div>
        {head}
        <p className="muted" role="status">
          {stage.name === 'saving' ? s.saving : s.reading}
        </p>
      </div>
    );
  }

  if (stage.name === 'done') {
    return (
      <div>
        {head}
        <section className="panel">
          <h2>{fill(s.doneTitle, { n: stage.added })}</h2>
          <p className="meta">{s.doneBody}</p>
          <Link className="btn brand" href="/me">
            {s.back}
          </Link>
        </section>
      </div>
    );
  }

  if (stage.name === 'preview') {
    return (
      <div>
        {head}
        <section className="panel">
          <h2>{s.freePreviewTitle}</h2>
          <p data-testid="preview-summary">
            {fill(s.freeSummary, {
              count: stage.count,
              spent: money(stage.spent, stage.currency, locale),
            })}
          </p>
          <ul className="list">
            {stage.first.map((row) => (
              <li key={row.index} className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className="meta">{row.date ?? ''}</span>
                <span className="grow" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  {row.description}
                </span>
                <strong>{money(BigInt(row.amount), stage.currency, locale)}</strong>
              </li>
            ))}
          </ul>
          <p className="meta">{fill(s.freeLeft, { n: stage.left })}</p>
        </section>
        <UpgradeCard />
        <button type="button" className="btn soft" onClick={() => setStage({ name: 'pick' })}>
          {s.again}
        </button>
      </div>
    );
  }

  if (stage.name === 'review') {
    const { plan, currency } = stage;
    const items = reviewItems(plan);
    const rowAmount = (item: StatementItem) =>
      edits[item.key]?.amountText ??
      toMajorString({ minor: BigInt(item.row.amount), currency: currency as CurrencyCode });
    const picked = items.filter((item) => ticked.has(item.key));
    const fresh = items.filter((item) => item.status === 'new');
    const allTicked = fresh.length > 0 && fresh.every((item) => ticked.has(item.key));
    const invalidKeys = new Set(
      picked
        .filter((item) => statementEntry(item, edits[item.key] ?? {}, currency, today) === null)
        .map((item) => item.key),
    );
    const sums = { out: 0n, inn: 0n };
    for (const item of picked) {
      const data = statementEntry(item, edits[item.key] ?? {}, currency, today);
      if (data) sums[item.section === 'out' ? 'out' : 'inn'] += BigInt(String(data.amount));
    }
    return (
      <div>
        {head}
        {errorBox}
        <section className="panel">
          <h2>{fill(s.reviewTitle, { count: items.length })}</h2>
          <p className="meta">
            {fill(s.reviewSummary, {
              added: plan.summary.added,
              skipped: plan.summary.duplicatesSkipped,
            })}
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={allTicked}
              onChange={() =>
                setTicked(
                  allTicked
                    ? new Set()
                    : new Set(items.filter((i) => i.status === 'new').map((i) => i.key)),
                )
              }
            />
            {s.selectAll}
          </label>
          {(['out', 'in'] as const).map((section) => {
            const rows = items.filter((item) => item.section === section);
            if (rows.length === 0) return null;
            return (
              <div key={section} className="list">
                <div className="row row-heading">{section === 'out' ? s.moneyOut : s.moneyIn}</div>
                {rows.map((item) => {
                  const note = statementNote(item);
                  const name = item.row.description;
                  return (
                    <div key={item.key} className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <input
                        type="checkbox"
                        aria-label={`${s.rowTick}: ${name}`}
                        checked={ticked.has(item.key)}
                        onChange={() => toggle(item.key)}
                      />
                      <span className="grow" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        <span className="meta">{item.row.date ?? today} </span>
                        <span className="title">{name}</span>
                        {note ? <span className="meta"> {s.notes[note]}</span> : null}
                      </span>
                      <input
                        aria-label={`${s.rowAmount}: ${name}`}
                        inputMode="decimal"
                        aria-invalid={invalidKeys.has(item.key) || undefined}
                        value={rowAmount(item)}
                        style={{ width: 110 }}
                        onChange={(event) => edit(item.key, { amountText: event.target.value })}
                      />
                      {invalidKeys.has(item.key) ? (
                        <span className="error" role="alert" style={{ flexBasis: '100%' }}>
                          {s.badAmount}
                        </span>
                      ) : null}
                      <select
                        aria-label={`${s.rowCategory}: ${name}`}
                        value={
                          (edits[item.key]?.category === undefined
                            ? guessFor(item)
                            : edits[item.key]!.category) ?? ''
                        }
                        onChange={(event) =>
                          edit(item.key, { category: event.target.value || null })
                        }
                      >
                        <option value="">{label(null)}</option>
                        {CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {t.categories[c.id]}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>
        <p className="meta" aria-live="polite" data-testid="selected-summary">
          {fill(s.selectedSummary, {
            n: picked.length,
            out: money(sums.out, currency, locale),
            inn: money(sums.inn, currency, locale),
          })}
        </p>
        <button
          type="button"
          className="btn brand"
          disabled={picked.length === 0 || invalidKeys.size > 0}
          onClick={() => void confirm(plan, currency)}
        >
          {fill(s.confirm, { n: picked.length })}
        </button>
      </div>
    );
  }

  return (
    <div>
      {head}
      {errorBox}
      {upgrade ? <UpgradeCard /> : null}
      <section className="panel">
        <p>{s.intro}</p>
        <p className="meta">{s.consent}</p>
        <input
          ref={input}
          type="file"
          hidden
          accept=".csv,.tsv,.txt,.xlsx,.xls,.ofx,.qfx,.pdf"
          data-testid="statement-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <button
          type="button"
          className="btn brand"
          disabled={planLoading}
          onClick={() => input.current?.click()}
        >
          {s.pick}
        </button>
      </section>
    </div>
  );
}

function UpgradeCard() {
  const { t } = useStrings();
  return (
    <section className="panel" data-testid="upgrade-card">
      <h2>{t.me.importPage.upgradeTitle}</h2>
      <p className="meta">{t.me.importPage.upgradeBody}</p>
      <Link className="btn brand" href="/settings/plan">
        {t.me.importPage.upgrade}
      </Link>
    </section>
  );
}
