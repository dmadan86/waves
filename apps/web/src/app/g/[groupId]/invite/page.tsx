'use client';

/**
 * The group's durable join link, in the browser.
 *
 * One stable token per group (A47), the WhatsApp model: the same link and the
 * same code every time it is opened, so it can be printed, pinned in a chat, or
 * held up across a table without minting a fresh invite per person. The first
 * time a group is ever shared the token is made on open — a brief wait, then
 * never again.
 *
 * The link's shape matters. `…/join#<token>` puts the token in the fragment,
 * which browsers never send to a server, so forwarding it through three chats
 * does not leave the key to a group in anybody's access log. It is the same
 * string the phone builds, and it lands on the same screen.
 *
 * Resetting is the admin's lever for a link that has spread further than it was
 * meant to: it rotates the token and every copy already out there stops working.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';

import type { GroupRow, Member } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { waves } from '@/lib/waves';
import { fill, plural } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

export default function InvitePage() {
  return <AppFrame current={Section.Groups}>{() => <Invite />}</AppFrame>;
}

function Invite() {
  const { t, locale } = useStrings();
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = token ? `${window.location.origin}/join#${token}` : null;

  const load = useCallback(async () => {
    const [row, people, joinToken] = await Promise.all([
      waves.groupRow(groupId),
      waves.members(groupId),
      waves.ensureGroupJoinToken(groupId),
    ]);
    setGroup(row);
    setMembers(people);
    setToken(joinToken);
  }, [groupId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active)
          setError(
            friendlyError(caught, 'web.invite.load', {
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

  const groupName = group?.name?.trim() || t.join.aGroup;
  const present = members.filter((member) => !member.left_at);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard (no permission, an insecure
      // origin) is not a failure worth a red line — the link is on screen and
      // selectable, which is what the copy button was a shortcut for.
    }
  };

  /**
   * The OS share sheet where there is one — a phone browser, mostly. Falls back
   * to copying, so the button always does something rather than being missing
   * on a desktop.
   */
  const share = async () => {
    if (!link) return;
    const text = fill(t.join.addedTo, { group: groupName });
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: groupName, text, url: link });
        return;
      } catch {
        // Dismissing the sheet lands here. Nothing failed and nothing changed.
        return;
      }
    }
    await copy();
  };

  const reset = async () => {
    if (!window.confirm(t.invite.resetConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      setToken(await waves.resetGroupJoinToken(groupId));
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.invite.reset', {
          fallback: t.errors.couldNotSave,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{t.invite.title}</h1>
        </div>

        <section className="panel" style={{ textAlign: 'center' }}>
          <h2>
            {group?.cover_emoji ? `${group.cover_emoji} ` : ''}
            {groupName}
          </h2>
          <p className="faint">{plural(locale, present.length, t.invite.alreadyHere)}</p>

          {link ? (
            <>
              {/* White ground and a wide quiet zone whatever the page theme is
                  doing: a code on a dark panel does not scan. */}
              <div
                style={{
                  display: 'inline-block',
                  background: '#ffffff',
                  padding: 16,
                  borderRadius: 16,
                  marginBlock: 16,
                }}
              >
                <QRCodeSVG value={link} size={208} level="H" marginSize={2} />
              </div>
              <p className="faint">{t.invite.scanToJoin}</p>

              <p className="linklike" style={{ wordBreak: 'break-all', marginBlock: 12 }}>
                {link}
              </p>

              <div className="people" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn" onClick={() => void share()}>
                  {t.invite.share}
                </button>
                <button type="button" className="btn soft" onClick={() => void copy()}>
                  {copied ? t.invite.copied : t.invite.copyLink}
                </button>
              </div>
            </>
          ) : (
            <p className="muted" style={{ marginBlock: 24 }}>
              {t.invite.making}
            </p>
          )}
        </section>

        {error ? <p className="error">{error}</p> : null}

        <section className="panel">
          <p className="faint">{fill(t.invite.trust, { group: groupName })}</p>
          <button type="button" className="btn soft" disabled={busy} onClick={() => void reset()}>
            {t.invite.reset}
          </button>
        </section>
      </div>
      <aside className="detail" />
    </div>
  );
}
