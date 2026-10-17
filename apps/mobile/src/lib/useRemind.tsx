/**
 * The one Remind action, everywhere a person can be reminded.
 *
 * Tapping Remind never guesses a channel: it opens a compact sheet that lists
 * how this reminder can go (`remindOptions` in `settleRow.ts`) and the person
 * picks. Waves is the in-app push (`useNudge`; the server's one-a-day limit is
 * read when the sheet opens and shown on the option, and still enforced on send); WhatsApp, SMS and
 * Share leave the app with a message that carries the amount and the group's
 * join link. The channel last used for a member is remembered on the device and
 * listed first with a tag; nothing is ever sent without a tap in the sheet.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Platform, Pressable, Share, View } from 'react-native';
import { iconSize, Sheet, Text, useTheme } from '@waves/ui';

import { ensureGroupJoinToken, fetchMyNudgeTimes, groupJoinLink } from '@/data/api';
import { isDemoGroupId } from '@/demo/ids';
import { fill, useStrings } from '@/i18n';
import { channelPlan, ghostReminderMessage } from '@/lib/ghostReminder';
import { useNudge, type NudgeTarget } from '@/lib/nudge';
import type { NudgeOutcome } from '@/lib/nudgeOutcome';
import {
  parseRemindChannel,
  nudgedWithinWindow,
  RemindChannel,
  remindOptions,
  RemindUnavailable,
} from '@/lib/settleRow';

const KEY_PREFIX = 'waves.remind_channel.';

/** Who was reminded off-app this session, by `${groupId}:${memberId}`. */
const remindedThisSession = new Set<string>();

export interface RemindTarget extends NudgeTarget {
  /** A Waves account, so the in-app push can reach them. */
  readonly joined: boolean;
  readonly phone?: string | null;
  /** The group's join token from the mirror, if it already has one. */
  readonly joinToken?: string | null;
  readonly name: string;
  readonly groupName: string;
  /** What they owe, already formatted ("₹1,200" or "€25 and ₹2,952"). */
  readonly amountText: string;
}

export interface UseRemind {
  /** Open the channel sheet. */
  open: () => void;
  /** Render once, anywhere in the screen. */
  sheet: ReactNode;
  /** The in-app push's verdict, once it lands. */
  outcome: NudgeOutcome | null;
  /** A reminder went out over any channel this session. */
  reminded: boolean;
  pending: boolean;
}

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

const ICONS = {
  [RemindChannel.Waves]: 'notifications-outline',
  [RemindChannel.WhatsApp]: 'logo-whatsapp',
  [RemindChannel.Sms]: 'chatbubble-outline',
  [RemindChannel.Share]: 'share-outline',
} as const;

export function useRemind(target: RemindTarget): UseRemind {
  const theme = useTheme();
  const { t } = useStrings();
  const key = `${target.groupId}:${target.memberId}`;
  const nudge = useNudge({
    groupId: target.groupId,
    memberId: target.memberId,
    currency: target.currency,
  });
  const [visible, setVisible] = useState(false);
  const [lastUsed, setLastUsed] = useState<RemindChannel | null>(null);
  const [sentKey, setSentKey] = useState<string | null>(null);
  const [externalPending, setExternalPending] = useState(false);
  const inFlight = useRef(false);
  const chosen = useRef<RemindChannel | null>(null);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    AsyncStorage.getItem(KEY_PREFIX + target.memberId)
      .then((stored) => {
        if (live) setLastUsed(parseRemindChannel(stored));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [visible, target.memberId]);

  const remember = (channel: RemindChannel): void => {
    setLastUsed(channel);
    void AsyncStorage.setItem(KEY_PREFIX + target.memberId, channel).catch(() => {});
  };

  const sendExternal = (channel: RemindChannel): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setExternalPending(true);
    void (async () => {
      try {
        // Someone on Waves has no use for a join link.
        const link = target.joined ? null : await joinLinkFor(target.groupId, target.joinToken);
        const message = ghostReminderMessage(
          link ? t.ghostRemind.message : t.ghostRemind.messageNoLink,
          {
            name: target.name,
            amount: target.amountText,
            group: target.groupName,
            link: link ?? '',
          },
        );
        const opened = await openFirst(channelPlan(channel, target.phone, message, Platform.OS));
        if (!opened) {
          const result = await Share.share({ message });
          if (result.action === Share.dismissedAction) return;
        }
        remindedThisSession.add(key);
        setSentKey(key);
        remember(channel);
      } catch {
        // The share sheet failed to open: nothing was sent, so nothing changes.
      } finally {
        inFlight.current = false;
        setExternalPending(false);
      }
    })();
  };

  const run = (channel: RemindChannel): void => {
    if (channel === RemindChannel.Waves) {
      remember(channel);
      nudge.send();
    } else {
      sendExternal(channel);
    }
  };

  // Whether Waves would refuse a nudge today, read when the sheet opens so the
  // option can say so before the tap. Advisory: if the read fails or is slow
  // the option stays enabled and the server's answer after the tap still wins.
  const nudgeTimes = useQuery({
    queryKey: ['nudge-times', target.groupId],
    queryFn: () => fetchMyNudgeTimes(target.groupId),
    enabled: visible && target.joined && target.memberId !== '',
    staleTime: 0,
    retry: 0,
  });
  const nudgedToday =
    nudge.outcome?.ok === true || nudgedWithinWindow(nudgeTimes.data?.get(target.memberId) ?? null);

  const options = remindOptions({
    nudgedToday,
    joined: target.joined,
    hasPhone: Boolean(target.phone && target.phone.replace(/\D/g, '')),
    lastUsed,
  });
  const labels = {
    [RemindChannel.Waves]: t.remindSheet.waves,
    [RemindChannel.WhatsApp]: t.remindSheet.whatsapp,
    [RemindChannel.Sms]: t.remindSheet.sms,
    [RemindChannel.Share]: t.remindSheet.share,
  } as const;

  const close = useCallback(() => setVisible(false), []);
  const sheet = (
    <Sheet
      visible={visible}
      onClose={() => {
        chosen.current = null;
        close();
      }}
      // The next overlay (WhatsApp, the share sheet) opens only once this one
      // has left the screen, or iOS drops it.
      onClosed={() => {
        const channel = chosen.current;
        chosen.current = null;
        if (channel) run(channel);
      }}
      closeLabel={t.common.close}
      title={fill(t.remindSheet.title, { name: target.name })}
    >
      <View style={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.md }}>
        <Text variant="caption" tone="muted">
          {fill(t.remindSheet.owes, { amount: target.amountText })}
        </Text>
        {options.map((option) => {
          const label = labels[option.channel];
          const reason =
            option.reason === RemindUnavailable.NotOnWaves
              ? t.remindSheet.notOnWaves
              : option.reason === RemindUnavailable.NudgedToday
                ? t.remindSheet.nudgedToday
                : null;
          return (
            <Pressable
              key={option.channel}
              accessibilityRole="button"
              accessibilityLabel={reason ? `${label}. ${reason}` : label}
              accessibilityState={{ disabled: !option.enabled }}
              disabled={!option.enabled}
              onPress={() => {
                chosen.current = option.channel;
                close();
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.md,
                backgroundColor: theme.color.bg,
                opacity: !option.enabled ? 0.5 : pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name={ICONS[option.channel]} size={iconSize.lg} color={theme.color.brand} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="subheading" numberOfLines={1}>
                  {label}
                </Text>
                {reason ? (
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {reason}
                  </Text>
                ) : null}
              </View>
              {option.lastUsed ? (
                <View
                  style={{
                    backgroundColor: theme.color.brandSoft,
                    borderRadius: theme.radius.pill,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: 2,
                  }}
                >
                  <Text variant="micro" style={{ color: theme.color.brand }}>
                    {t.remindSheet.lastUsed}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );

  return {
    open: () => setVisible(true),
    sheet,
    outcome: nudge.outcome,
    reminded: Boolean(nudge.outcome) || sentKey === key || remindedThisSession.has(key),
    pending: nudge.pending || externalPending,
  };
}
