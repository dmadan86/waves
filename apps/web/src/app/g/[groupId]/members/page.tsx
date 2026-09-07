'use client';

/**
 * Who is in a group, and the small set of things you can do about it.
 *
 * Three kinds of person show up in one list and the difference matters:
 *
 *   * **you**, who can leave but not remove yourself twice over;
 *   * somebody with an account, who can be made an admin;
 *   * a **ghost** — a name typed in by whoever started the group, with real
 *     expenses filed against it, waiting for the person to claim it through an
 *     invite (ADR-006). A ghost is not a lesser member; it is a member who has
 *     not arrived.
 *
 * Removing is deliberately absent for anybody who has arrived: a person with a
 * balance cannot be quietly dropped out of a ledger. Leaving is theirs to do,
 * and it is soft — the history stays.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import type { GroupRow, Member } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { waves } from '@/lib/waves';
import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

export default function MembersPage() {
  return (
    <AppFrame current={Section.Groups}>
      {({ profileId }) => <Members profileId={profileId} />}
    </AppFrame>
  );
}

function Members({ profileId }: { profileId: string }) {
  const { t } = useStrings();
  const params = useParams<{ groupId: string }>();
  const router = useRouter();
  const groupId = params.groupId;

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const load = useCallback(async () => {
    const [row, people] = await Promise.all([waves.groupRow(groupId), waves.members(groupId)]);
    setGroup(row);
    setMembers(people);
  }, [groupId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active)
          setError(
            friendlyError(caught, 'web.members.load', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [load, t.errors.couldNotLoad, t.errors.offline]);

  /** Every write goes through here, so one failure path serves them all. */
  const run = async (action: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      after?.();
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.members.write', {
          fallback: t.errors.couldNotSave,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const me = members.find((member) => member.profile_id === profileId) ?? null;
  const iAmAdmin = me?.role === 'admin';

  const nameOf = (member: Member) =>
    member.profile?.display_name?.trim() || member.ghost_name?.trim() || t.join.someone;

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <div>
            <h1>{t.members.title}</h1>
            <div className="sub">
              {group?.cover_emoji ? `${group.cover_emoji} ` : ''}
              {group?.name?.trim() || t.join.aGroup}
            </div>
          </div>
          <Link className="btn" href={`/g/${groupId}/invite`}>
            {t.members.inviteInstead}
          </Link>
        </div>

        <section className="panel">
          {loading ? (
            <SkeletonRows rows={4} />
          ) : (
            <div className="list">
              {members.map((member) => {
                const isMe = member.profile_id === profileId;
                const isGhost = !member.profile_id;
                return (
                  <div key={member.id} className="item" style={{ cursor: 'default' }}>
                    <span className="avatar" aria-hidden style={{ width: 38, height: 38 }}>
                      {nameOf(member).charAt(0).toUpperCase()}
                    </span>
                    <span className="grow">
                      <span className="title">
                        {nameOf(member)}
                        {isMe ? ` · ${t.members.you}` : ''}
                      </span>
                      <span className="meta">
                        {member.role === 'admin' ? t.members.admin : ''}
                        {member.role === 'admin' && isGhost ? ' · ' : ''}
                        {isGhost ? t.members.ghost : ''}
                      </span>
                    </span>
                    {iAmAdmin && !isMe && member.profile_id ? (
                      <button
                        type="button"
                        className="btn soft"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            waves.setMemberRole(
                              member.id,
                              member.role === 'admin' ? 'member' : 'admin',
                            ),
                          )
                        }
                      >
                        {member.role === 'admin' ? t.members.removeAdmin : t.members.makeAdmin}
                      </button>
                    ) : null}
                    {iAmAdmin && isGhost ? (
                      <button
                        type="button"
                        className="btn soft"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(fill(t.members.removeConfirm, { name: nameOf(member) }))
                          )
                            return;
                          void run(() => waves.leaveGroup(member.id));
                        }}
                      >
                        {t.members.remove}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <p className="faint" style={{ marginBlockStart: 12 }}>
            {t.members.ghostBody}
          </p>
        </section>

        <section className="panel">
          <h2>{t.members.addTitle}</h2>
          <label className="field">
            <span className="field-label">{t.members.namePlaceholder}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t.members.namePlaceholder}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span className="field-label">{t.members.emailPlaceholder}</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t.members.emailPlaceholder}
              inputMode="email"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span className="field-label">{t.members.phonePlaceholder}</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={t.members.phonePlaceholder}
              inputMode="tel"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || !name.trim()}
            onClick={() =>
              void run(
                () =>
                  waves
                    .addGhostMember({
                      groupId,
                      name,
                      email: email || null,
                      phone: phone || null,
                    })
                    .then(() => undefined),
                () => {
                  setName('');
                  setEmail('');
                  setPhone('');
                },
              )
            }
          >
            {t.members.add}
          </button>
        </section>

        {error ? <p className="error">{error}</p> : null}

        {me ? (
          <section className="panel">
            <button
              type="button"
              className="btn soft"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(t.members.leaveConfirm)) return;
                void run(
                  () => waves.leaveGroup(me.id),
                  () => router.replace('/groups'),
                );
              }}
            >
              {t.members.leave}
            </button>
          </section>
        ) : null}
      </div>
      <aside className="detail" />
    </div>
  );
}
