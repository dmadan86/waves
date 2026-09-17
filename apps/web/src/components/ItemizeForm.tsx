'use client';

/**
 * Splitting a bill by what each person actually had (ADR-008 §3.1).
 *
 * The argument this settles is the one an equal split causes: four people eat,
 * one of them has a starter and two drinks, and dividing by four quietly makes
 * the other three pay for it. Here each line is claimed by whoever had it, a
 * line claimed by several splits equally between them, and tax, service and tip
 * are prorated by each person's item subtotal — never split equally, which is
 * the other half of the same argument.
 *
 * The maths is `computeShares` in `@waves/core`, the same function the server
 * runs. Nothing here divides anything: the preview is the real answer computed
 * locally, and the server recomputes it from the parameters anyway (TDR §4).
 *
 * Two things the phone has that this deliberately does not:
 *
 * - **Scanning the bill.** That is a camera and an on-device OCR model. The
 *   browser types its lines.
 * - **Claiming round a table.** The phone can hand a scanned bill to everybody
 *   present and let each person tap their own lines, live. That needs the
 *   published-receipt half of the flow; this is the single-editor mode, where
 *   one person holds the bill and says who had what.
 *
 * An unclaimed line is refused rather than quietly split — `computeShares`
 * throws `UnclaimedItem`, and this screen says which line before it can be
 * saved. A bill where nobody has admitted to the fourth beer is not a bill you
 * can divide.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListPlus, Plus, X } from 'lucide-react';

import {
  computeShares,
  minorUnitScale,
  parseMajor,
  serialiseSplitParams,
  type CurrencyCode,
} from '@waves/core';
import { nameOf, type Group, type Member } from '@waves/api-client';

import { EmptyState } from '@/components/EmptyState';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { billTotal, claimants, itemizedParams, unclaimed } from '@/lib/itemize';
import { money } from '@/lib/money';
import { waves } from '@/lib/waves';

/** One line of the bill as it is being typed. */
interface Line {
  /** Stable across edits, so React keeps the inputs a person is typing in. */
  key: string;
  label: string;
  amountText: string;
  /** Who had it. Empty means nobody has said yet, which blocks the save. */
  claimers: string[];
}

/** The extras, which are prorated rather than shared out equally. */
type Extra = 'taxes' | 'serviceCharge' | 'tip' | 'discounts';
const EXTRAS: Extra[] = ['taxes', 'serviceCharge', 'tip', 'discounts'];

function emptyLine(): Line {
  return { key: crypto.randomUUID(), label: '', amountText: '', claimers: [] };
}

export function ItemizeForm({ groupId, myProfileId }: { groupId: string; myProfileId: string }) {
  const router = useRouter();
  const { t, locale } = useStrings();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);

  const [description, setDescription] = useState('');
  // Today, like the add form: a bill is typed the day it is eaten.
  const expenseDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [lines, setLines] = useState<Line[]>(() => [emptyLine()]);
  const [extras, setExtras] = useState<Record<Extra, string>>({
    taxes: '',
    serviceCharge: '',
    tip: '',
    discounts: '',
  });
  const [payer, setPayer] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [loadedGroup, loadedMembers] = await Promise.all([
          waves.group(groupId),
          waves.members(groupId),
        ]);
        if (!active) return;
        setGroup(loadedGroup);
        setMembers(loadedMembers);
        // Whoever is holding the bill is usually the one who paid it.
        setPayer(loadedMembers.find((row) => row.profile_id === myProfileId)?.id ?? null);
        setReady(true);
      } catch (caught) {
        if (!active) return;
        setLoadFailed(
          friendlyError(caught, 'web.itemize.load', {
            fallback: t.errors.couldNotLoad,
            offline: t.errors.offline,
          }),
        );
        setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [groupId, myProfileId, t.errors.couldNotLoad, t.errors.offline]);

  const currency = (group?.default_currency ?? 'INR') as CurrencyCode;
  /**
   * What the input may be nudged by: 1 for a currency with no minor unit (JPY),
   * 0.01 for INR, 0.001 for KWD. Read off the scale rather than assumed to be
   * two places — nothing in this app may assume 100.
   */
  const step = useMemo(() => {
    const digits = String(minorUnitScale(currency)).length - 1;
    return digits === 0 ? '1' : `0.${'0'.repeat(digits - 1)}1`;
  }, [currency]);

  const minor = useCallback(
    (text: string): bigint | null => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      try {
        return parseMajor(trimmed, currency).minor;
      } catch {
        return null;
      }
    },
    [currency],
  );

  const editLine = useCallback((key: string, patch: Partial<Line>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }, []);

  const claim = useCallback((key: string, memberId: string) => {
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? {
              ...line,
              claimers: line.claimers.includes(memberId)
                ? line.claimers.filter((id) => id !== memberId)
                : [...line.claimers, memberId],
            }
          : line,
      ),
    );
  }, []);

  const total = useMemo(() => billTotal(lines, extras, minor), [lines, extras, minor]);

  /** Everybody who claimed a line that counts. Nobody else is on this bill. */
  const participants = useMemo(() => claimants(lines, minor), [lines, minor]);

  const params = useMemo(() => itemizedParams(lines, extras, minor), [lines, extras, minor]);

  // The preview is the real computation, and its failure is the validation:
  // core refuses an unclaimed line, so there is no second list of rules here
  // that could disagree with the one the server runs.
  const outcome = useMemo(() => {
    if (!params || participants.length === 0 || total <= 0n) return null;
    try {
      return {
        shares: computeShares({
          amount: total,
          currency,
          params,
          participants,
          seed: 'preview',
        }),
        problem: null as string | null,
      };
    } catch {
      // Which line, said plainly. An index is not an answer somebody can act on.
      const waiting = unclaimed(lines, minor);
      return {
        shares: null,
        problem: waiting.length
          ? fill(t.itemize.unclaimed, {
              lines: waiting.map((line) => line.label.trim() || t.itemize.untitledLine).join(', '),
            })
          : t.itemize.cannotSplit,
      };
    }
  }, [params, participants, total, currency, lines, minor, t.itemize]);

  const save = useCallback(async () => {
    if (!params || !payer || !outcome?.shares) return;
    setError(null);
    setSaving(true);
    try {
      await waves.writeExpense({
        groupId,
        description: description.trim() || t.itemize.defaultDescription,
        expenseDate,
        currency,
        amount: total,
        splitParams: serialiseSplitParams(params),
        participants,
        payers: { [payer]: total },
        expectedShares: Object.fromEntries(outcome.shares),
        clientMutationId: crypto.randomUUID(),
      });
      router.replace(`/g/${groupId}`);
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.itemize.submit', {
          fallback: t.errors.couldNotSave,
          offline: t.errors.offline,
        }),
      );
      setSaving(false);
    }
  }, [
    params,
    payer,
    outcome,
    groupId,
    description,
    expenseDate,
    currency,
    total,
    participants,
    router,
    t.itemize.defaultDescription,
    t.errors.couldNotSave,
    t.errors.offline,
  ]);

  if (!ready) return <SkeletonRows rows={4} />;
  if (loadFailed) return <p className="error">{loadFailed}</p>;
  if (members.length === 0) {
    return <EmptyState Icon={ListPlus} title={t.itemize.title} body={t.itemize.noMembers} />;
  }

  return (
    <div>
      <section className="panel">
        <div className="panel-head">
          <h2>{t.itemize.title}</h2>
        </div>

        <label className="field">
          <span>{t.add.whatWasIt}</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t.itemize.defaultDescription}
          />
        </label>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.itemize.lines}</h2>
        </div>

        <ul className="lines">
          {lines.map((line) => (
            <li key={line.key} className="line">
              <div className="line-head">
                <input
                  className="line-label"
                  value={line.label}
                  onChange={(event) => editLine(line.key, { label: event.target.value })}
                  placeholder={t.itemize.linePlaceholder}
                  aria-label={t.itemize.linePlaceholder}
                />
                <input
                  className="line-amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step={step}
                  value={line.amountText}
                  onChange={(event) => editLine(line.key, { amountText: event.target.value })}
                  placeholder="0"
                  aria-label={t.add.howMuch}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() =>
                    setLines((current) => current.filter((row) => row.key !== line.key))
                  }
                  aria-label={t.itemize.removeLine}
                  // The last line stays: an empty list has nothing to type into.
                  disabled={lines.length === 1}
                >
                  <X size={16} strokeWidth={1.75} aria-hidden />
                </button>
              </div>

              {/* Who had it. A line claimed by several splits equally between
                  them, so two names on the starter is the starter halved. */}
              <div className="people">
                {members.map((member) => {
                  const claimed = line.claimers.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      className="chip"
                      aria-pressed={claimed}
                      onClick={() => claim(line.key, member.id)}
                    >
                      {nameOf(member)}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn soft"
          onClick={() => setLines((current) => [...current, emptyLine()])}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          {t.itemize.addLine}
        </button>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.itemize.extras}</h2>
        </div>
        <p className="meta">{t.itemize.extrasNote}</p>

        <div className="extras">
          {EXTRAS.map((name) => (
            <label key={name} className="field">
              <span>{t.itemize[name]}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step={step}
                value={extras[name]}
                onChange={(event) =>
                  setExtras((current) => ({ ...current, [name]: event.target.value }))
                }
                placeholder="0"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.add.whoPaid}</h2>
        </div>
        <div className="people">
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              className="chip"
              aria-pressed={payer === member.id}
              onClick={() => setPayer(member.id)}
            >
              {nameOf(member)}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.itemize.preview}</h2>
          <span className="amount">{money(total, currency, locale)}</span>
        </div>

        {outcome?.shares ? (
          <div className="list">
            {[...outcome.shares].map(([memberId, share]) => {
              const member = members.find((row) => row.id === memberId);
              return (
                <div key={memberId} className="item" style={{ cursor: 'default' }}>
                  <span className="grow">
                    <span className="title">{member ? nameOf(member) : t.join.someone}</span>
                  </span>
                  <span className="amount">{money(share, currency, locale)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="meta">{outcome?.problem ?? t.itemize.startTyping}</p>
        )}
      </section>

      {error ? <p className="error">{error}</p> : null}

      <button
        type="button"
        className="btn brand block"
        disabled={saving || !outcome?.shares || !payer}
        onClick={() => void save()}
      >
        {saving ? t.add.saving : t.add.save}
      </button>
    </div>
  );
}
