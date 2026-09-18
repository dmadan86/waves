'use client';

/**
 * Add a person, and the amount between you.
 *
 * The rest of the app records a debt inside a group, because a debt is between
 * people *about something*. This is the shortcut for the plainest case of all:
 * "Ravi owes me ₹500" with no trip, no bill, and no app on Ravi's phone. Under
 * it this is still a group — a one-to-one group named after the person, with a
 * single expense that produces the balance — so it shows on the dashboard and
 * folds into the Friends totals like any other. Nothing here is a new kind of
 * record; it is the ordinary primitives wired to one screen.
 *
 * The direction defaults to "they owe me", which is what people open this for,
 * but it stays a visible selected choice rather than a hidden assumption.
 *
 * Where this differs from the phone: there, all three writes ride one offline
 * queue under ids the device mints, so the IOU is one unit that either lands or
 * waits. Here they are three calls to a server, and the middle one can fail —
 * leaving a group that exists with nothing in it. That state gets said out
 * loud, with a link to the group, rather than hidden behind "could not save":
 * a person who is told nothing happened, when a group did, goes looking for a
 * bug that is actually a half-finished save.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { GroupType, type Member, type ProfileRow } from '@waves/api-client';
import { type CurrencyCode, parseMajor, serialiseSplitParams } from '@waves/core';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

type Direction = 'theyOwe' | 'iOwe';

/** Today where the reader is, never parsed back into a date. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

export default function AddPersonPage() {
  return <AppFrame current={Section.Friends}>{() => <AddPerson />}</AppFrame>;
}

function AddPerson() {
  const { t } = useStrings();
  const router = useRouter();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [direction, setDirection] = useState<Direction>('theyOwe');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * A group made, with no amount in it. Kept in state rather than thrown away,
   * because the only useful thing to hand somebody in that state is the way in.
   */
  const [halfDone, setHalfDone] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const row = await waves.myProfile();
        if (active) setProfile(row);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const currency = (profile?.default_currency ?? 'INR') as CurrencyCode;

  // Minor units, through the same parser the expense form uses: the exponent
  // belongs to the currency, and ¥15000 is not ₹15000 in minor units.
  const amount = useMemo(() => {
    const trimmed = amountText.trim();
    if (!trimmed) return null;
    try {
      const minor = parseMajor(trimmed, currency).minor;
      return minor > 0n ? minor : null;
    } catch {
      return null;
    }
  }, [amountText, currency]);

  const canSave = name.trim().length > 0 && amount !== null && !saving;

  const save = async (): Promise<void> => {
    if (!canSave || amount === null) return;
    const personName = name.trim();
    setError(null);
    setHalfDone(null);
    setSaving(true);

    let groupId: string | null = null;
    try {
      groupId = await waves.createGroup({
        name: personName,
        type: GroupType.Other,
        currency,
      });

      // The RPC mints the creator's membership rather than taking an id, so
      // the expense below has to ask which member is me. Reading it back is
      // the only honest answer — a client that guessed would be writing an
      // expense against a member it invented.
      const members = await waves.members(groupId);
      const mine = members.find((member: Member) => member.profile_id === profile?.id);
      if (!mine) throw new Error('NO_MEMBERSHIP');

      const ghostId = await waves.addGhostMember({ groupId, name: personName });

      // One expense that books the whole amount against the debtor: the payer
      // put the money in, the debtor's share is the lot, so the debtor owes
      // the payer exactly `amount`. "They owe me" makes me the payer.
      const theyOwe = direction === 'theyOwe';
      const payerId = theyOwe ? mine.id : ghostId;
      const debtorId = theyOwe ? ghostId : mine.id;

      await waves.writeExpense({
        groupId,
        description: note.trim() || personName,
        expenseDate: today(),
        currency,
        amount,
        participants: [mine.id, ghostId],
        payers: { [payerId]: amount },
        splitParams: serialiseSplitParams({
          kind: 'exact',
          amounts: { [debtorId]: amount, [payerId]: 0n },
        }),
        expectedShares: { [debtorId]: amount, [payerId]: 0n },
        clientMutationId: crypto.randomUUID(),
      });

      router.replace(`/g/${groupId}`);
    } catch (caught) {
      // A group that exists with nothing in it is not "could not save". Name
      // it, and give the way in.
      if (groupId) setHalfDone(groupId);
      setError(
        friendlyError(caught, 'web.addPerson.save', {
          fallback: t.addPerson.couldNotRecord,
          offline: t.errors.offline,
        }),
      );
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={4} />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.addPerson.title}</h1>
          <div className="sub">{t.addPerson.subtitle}</div>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <section className="panel">
          <label className="field">
            <span className="field-label">{t.addPerson.nameLabel}</span>
            <input
              value={name}
              autoFocus
              disabled={saving}
              autoComplete="off"
              placeholder={t.addPerson.namePlaceholder}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">{`${t.addPerson.amountLabel} (${currency})`}</span>
            <input
              value={amountText}
              disabled={saving}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              onChange={(event) => setAmountText(event.target.value)}
            />
          </label>

          {/* Both ways on screen, one selected. A default nobody can see is an
              assumption; a default somebody can see is a choice. */}
          <div className="field">
            <span className="field-label">{t.addPerson.directionQuestion}</span>
            <div className="lang-list" role="radiogroup" aria-label={t.addPerson.directionQuestion}>
              {(['theyOwe', 'iOwe'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={direction === option}
                  className={direction === option ? 'lang-option on' : 'lang-option'}
                  disabled={saving}
                  onClick={() => setDirection(option)}
                >
                  {option === 'theyOwe' ? t.addPerson.theyOweMe : t.addPerson.iOweThem}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">{t.addPerson.noteLabel}</span>
            <input
              value={note}
              disabled={saving}
              autoComplete="off"
              placeholder={t.addPerson.notePlaceholder}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          {/* The group outlived the failure, so it gets a door rather than a
              sentence somebody has to act on from memory. */}
          {halfDone ? (
            <>
              <p className="error">{t.addPerson.halfDone}</p>
              <Link className="btn soft" href={`/g/${halfDone}`}>
                {t.addPerson.openGroup}
              </Link>
            </>
          ) : null}

          <button type="submit" className="btn brand" disabled={!canSave}>
            {t.addPerson.save}
          </button>
        </section>
      </form>
    </div>
  );
}
