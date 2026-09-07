'use client';

/**
 * Starting a group, which the browser could not do at all.
 *
 * Everything on this page is optional except the currency, and that has a
 * default. A group with no name is labelled by who is in it — that is a
 * deliberate product decision, not a gap, so the name field never blocks the
 * button.
 *
 * People typed in here become *ghosts*: a name in the group with expenses
 * against it, which the real person claims when they open the invite (ADR-006).
 * That is why they are added one at a time and by name only — the point is to
 * start splitting tonight, not to fill in a contact book.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { GroupType } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { waves } from '@/lib/waves';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

/** The currencies the picker offers. Anything else is set on the phone. */
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'] as const;

/** A few icons, so a group is recognisable in a list at a glance. */
const EMOJI = ['🏖️', '🏠', '❤️', '🎉', '👥', '🍽️', '✈️', '🎬', '🏔️', '🛒'] as const;

export default function NewGroupPage() {
  return <AppFrame current={Section.Groups}>{() => <NewGroup />}</AppFrame>;
}

function NewGroup() {
  const { t } = useStrings();
  const router = useRouter();

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string>('🏖️');
  const [currency, setCurrency] = useState<string>('INR');
  const [type, setType] = useState<GroupType>(GroupType.Trip);
  const [simplify, setSimplify] = useState(true);
  const [people, setPeople] = useState<string[]>([]);
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const types: { value: GroupType; label: string }[] = [
    { value: GroupType.Trip, label: t.newGroup.typeTrip },
    { value: GroupType.Home, label: t.newGroup.typeHome },
    { value: GroupType.Couple, label: t.newGroup.typeCouple },
    { value: GroupType.Friends, label: t.newGroup.typeFriends },
    { value: GroupType.Event, label: t.newGroup.typeEvent },
    { value: GroupType.Other, label: t.newGroup.typeOther },
  ];

  const addPerson = () => {
    const trimmed = person.trim();
    if (!trimmed) return;
    setPeople((current) => [...current, trimmed]);
    setPerson('');
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    let groupId: string;
    try {
      groupId = await waves.createGroup({
        name: name.trim() || null,
        type,
        currency,
        emoji,
        simplify,
      });
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.newGroup.create', {
          fallback: t.errors.couldNotSave,
          offline: t.errors.offline,
        }),
      );
      setBusy(false);
      return;
    }

    // Past this line the group exists, and that is the whole reason the two
    // steps are separated. A failure adding people must never leave the button
    // ready to press again: pressing it would make a *second* group and the
    // first would still be sitting there. So whatever happens next, this goes
    // to the group, where whoever is missing can be added without starting
    // over.
    try {
      for (const who of people) {
        await waves.addGhostMember({ groupId, name: who });
      }
    } catch {
      // Deliberately swallowed. The group page is the honest place to see who
      // made it in and who did not.
    }
    router.replace(`/g/${groupId}`);
  };

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{t.newGroup.title}</h1>
        </div>

        <section className="panel">
          <p className="faint">{t.newGroup.intro}</p>

          <label className="field">
            <span className="field-label">{t.newGroup.nameLabel}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t.newGroup.namePlaceholder}
              autoComplete="off"
            />
          </label>

          <div className="field">
            <span className="field-label">{t.newGroup.emojiLabel}</span>
            <div className="people">
              {EMOJI.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className="chip"
                  aria-pressed={emoji === icon}
                  onClick={() => setEmoji(icon)}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t.newGroup.typeLabel}</span>
            <div className="people">
              {types.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="chip"
                  aria-pressed={type === option.value}
                  onClick={() => setType(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">{t.newGroup.currencyLabel}</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>

          <label className="field row-field">
            <input
              type="checkbox"
              checked={simplify}
              onChange={(event) => setSimplify(event.target.checked)}
            />
            <span>
              <span className="field-label">{t.newGroup.simplifyLabel}</span>
              <span className="faint"> {t.newGroup.simplifyBody}</span>
            </span>
          </label>
        </section>

        <section className="panel">
          <h2>{t.newGroup.peopleLabel}</h2>
          <p className="faint">{t.newGroup.peopleBody}</p>
          <div className="row-field">
            <input
              value={person}
              onChange={(event) => setPerson(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addPerson();
                }
              }}
              placeholder={t.newGroup.personPlaceholder}
              aria-label={t.newGroup.personPlaceholder}
            />
            <button type="button" className="btn soft" onClick={addPerson}>
              {t.newGroup.addPerson}
            </button>
          </div>
          {people.length > 0 ? (
            <div className="people" style={{ marginBlockStart: 12 }}>
              {people.map((who, index) => (
                <button
                  key={`${who}-${index}`}
                  type="button"
                  className="chip"
                  onClick={() => setPeople((current) => current.filter((_, at) => at !== index))}
                  aria-label={`${t.members.remove} ${who}`}
                >
                  {who} ✕
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {error ? <p className="error">{error}</p> : null}

        <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
          {busy ? t.newGroup.creating : t.newGroup.create}
        </button>
      </div>
      <aside className="detail" />
    </div>
  );
}
