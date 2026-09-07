'use client';

/**
 * What a group is, and how it ends.
 *
 * The top half is ordinary editing — a name, an icon, the currency new
 * expenses default to, and whether debts are simplified. The bottom half is the
 * two ways out, and they are deliberately different things:
 *
 *   * **Archive** is "off my list". Nothing is deleted, the numbers are still
 *     there, and it comes back.
 *   * **Delete** removes the group for everybody. The server allows it only
 *     when everyone is square and only for an admin, so the two refusals it can
 *     give are turned into sentences rather than shown raw.
 *
 * Changing the currency does not convert anything: expenses keep the currency
 * they were entered in (ADR-004), and the note says so, because a screen that
 * quietly re-denominated a ledger would be the worst bug this app could have.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { GroupType, type GroupRow } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { waves } from '@/lib/waves';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'] as const;
const EMOJI = ['🏖️', '🏠', '❤️', '🎉', '👥', '🍽️', '✈️', '🎬', '🏔️', '🛒'] as const;

export default function GroupSettingsPage() {
  return (
    <AppFrame current={Section.Groups}>
      {({ profileId }) => <GroupSettings profileId={profileId} />}
    </AppFrame>
  );
}

function GroupSettings({ profileId }: { profileId: string }) {
  const { t } = useStrings();
  const params = useParams<{ groupId: string }>();
  const router = useRouter();
  const groupId = params.groupId;

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [iAmAdmin, setIAmAdmin] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [currency, setCurrency] = useState('INR');
  const [type, setType] = useState<GroupType>(GroupType.Trip);
  const [simplify, setSimplify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [row, members] = await Promise.all([waves.groupRow(groupId), waves.members(groupId)]);
    if (!row) return;
    setGroup(row);
    setName(row.name ?? '');
    setEmoji(row.cover_emoji);
    setCurrency(row.default_currency);
    setType(row.type);
    setSimplify(row.simplify_debts);
    setIAmAdmin(
      members.some((member) => member.profile_id === profileId && member.role === 'admin'),
    );
  }, [groupId, profileId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active)
          setError(
            friendlyError(caught, 'web.groupSettings.load', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [load, t.errors.couldNotLoad, t.errors.offline]);

  const run = async (action: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await action();
      after?.();
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.groupSettings.write', {
          fallback: t.errors.couldNotSave,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const types: { value: GroupType; label: string }[] = [
    { value: GroupType.Trip, label: t.newGroup.typeTrip },
    { value: GroupType.Home, label: t.newGroup.typeHome },
    { value: GroupType.Couple, label: t.newGroup.typeCouple },
    { value: GroupType.Friends, label: t.newGroup.typeFriends },
    { value: GroupType.Event, label: t.newGroup.typeEvent },
    { value: GroupType.Other, label: t.newGroup.typeOther },
  ];

  const archived = Boolean(group?.archived_at);

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{t.groupSettings.title}</h1>
        </div>

        <section className="panel">
          <label className="field">
            <span className="field-label">{t.groupSettings.nameLabel}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t.newGroup.namePlaceholder}
              autoComplete="off"
            />
          </label>

          <div className="field">
            <span className="field-label">{t.groupSettings.emojiLabel}</span>
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
            <span className="field-label">{t.groupSettings.currencyLabel}</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <span className="faint">{t.groupSettings.currencyNote}</span>
          </label>

          <label className="field row-field">
            <input
              type="checkbox"
              checked={simplify}
              onChange={(event) => setSimplify(event.target.checked)}
            />
            <span>
              <span className="field-label">{t.groupSettings.simplifyLabel}</span>
              <span className="faint"> {t.groupSettings.simplifyBody}</span>
            </span>
          </label>

          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  waves.updateGroup(groupId, {
                    name: name.trim() || null,
                    cover_emoji: emoji,
                    default_currency: currency,
                    type,
                    simplify_debts: simplify,
                  }),
                () => setSaved(true),
              )
            }
          >
            {saved ? t.groupSettings.saved : t.groupSettings.save}
          </button>
        </section>

        {error ? <p className="error">{error}</p> : null}

        <section className="panel">
          <h2>{t.exportData.title}</h2>
          <p className="faint">{t.exportData.body}</p>
          <Link className="btn soft" href={`/g/${groupId}/export`}>
            {t.exportData.title}
          </Link>
        </section>

        <section className="panel">
          <h2>{t.groupSettings.danger}</h2>
          <p className="faint">{t.groupSettings.archiveBody}</p>
          <button
            type="button"
            className="btn soft"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  waves.updateGroup(groupId, {
                    archived_at: archived ? null : new Date().toISOString(),
                  }),
                () => void load(),
              )
            }
          >
            {archived ? t.groupSettings.unarchive : t.groupSettings.archive}
          </button>

          <p className="faint" style={{ marginBlockStart: 18 }}>
            {t.groupSettings.deleteBody}
          </p>
          <button
            type="button"
            className="btn soft"
            disabled={busy || !iAmAdmin}
            onClick={() => {
              if (!window.confirm(t.groupSettings.deleteConfirm)) return;
              void run(
                () => waves.deleteGroup(groupId),
                () => router.replace('/groups'),
              );
            }}
          >
            {t.groupSettings.delete}
          </button>
          {!iAmAdmin ? <p className="faint">{t.groupSettings.adminOnly}</p> : null}
        </section>
      </div>
      <aside className="detail" />
    </div>
  );
}
