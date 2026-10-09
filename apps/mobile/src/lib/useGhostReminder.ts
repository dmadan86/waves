/**
 * The Remind button for someone who is not on Waves yet.
 *
 * The app's own nudge is a push and needs an account, so this one leaves the
 * app: WhatsApp to their phone, mail to their email, or the share sheet, with a
 * message that carries the group's join link (so the reminder is also the
 * invite). The URLs and their order are `ghostReminder.ts`; this only opens
 * them and remembers, for the rest of the session, that it was sent. There is
 * no server state: a reminder sent from your own WhatsApp is yours to repeat.
 */
import { useRef, useState } from 'react';
import { Linking, Platform, Share } from 'react-native';

import { ensureGroupJoinToken, groupJoinLink } from '@/data/api';
import { isDemoGroupId } from '@/demo/ids';
import { GhostChannel, ghostChannel, ghostReminderPlan } from '@/lib/ghostReminder';

/** Who was reminded this session, by `${groupId}:${memberId}`. */
const remindedThisSession = new Set<string>();

export interface GhostReminderTarget {
  readonly groupId: string;
  readonly memberId: string;
  readonly phone?: string | null;
  readonly email?: string | null;
  /** The group's join token from the mirror, if it already has one. */
  readonly joinToken?: string | null;
}

export interface GhostReminderText {
  readonly message: string;
  readonly subject: string;
}

/** The join link, minting the token the first time a group is ever shared. */
async function joinLinkFor(groupId: string, joinToken?: string | null): Promise<string | null> {
  if (joinToken) return groupJoinLink(joinToken);
  if (isDemoGroupId(groupId)) return null;
  try {
    return groupJoinLink(await ensureGroupJoinToken(groupId));
  } catch {
    return null;
  }
}

async function openFirst(urls: readonly string[]): Promise<boolean> {
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Nothing installed answers this one; try the next.
    }
  }
  return false;
}

export function useGhostReminder(target: GhostReminderTarget): {
  channel: GhostChannel;
  reminded: boolean;
  pending: boolean;
  /** `compose` gets the join link (null when none could be made). */
  send: (compose: (link: string | null) => GhostReminderText) => void;
} {
  const key = `${target.groupId}:${target.memberId}`;
  const contact = { phone: target.phone, email: target.email };
  const channel = ghostChannel(contact);
  const [sentKey, setSentKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const send = (compose: (link: string | null) => GhostReminderText): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    void (async () => {
      try {
        const link = await joinLinkFor(target.groupId, target.joinToken);
        const { message, subject } = compose(link);
        const opened = await openFirst(ghostReminderPlan(contact, message, subject, Platform.OS));
        if (!opened) {
          const result = await Share.share({ message });
          if (result.action === Share.dismissedAction) return;
        }
        remindedThisSession.add(key);
        setSentKey(key);
      } catch {
        // The share sheet failed to open: nothing was sent, so nothing changes.
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    })();
  };

  return {
    channel,
    reminded: sentKey === key || remindedThisSession.has(key),
    pending,
    send,
  };
}
