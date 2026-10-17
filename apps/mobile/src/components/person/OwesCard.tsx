/**
 * "Owes you ₹825.00" / "You owe ₹825.00" — the one card that says what stands
 * between you and a person, and what to do about it.
 *
 * The figure is the pair's total from core (`pairBalances`), the same one the
 * Who-pays-whom screen leads with, so the two can never read differently. Remind
 * opens the shared channel sheet (`useRemind`) and Settle up opens the pair
 * screen; both are hidden for somebody blocked on this device.
 *
 * A reminder is written against one group's ledger (the in-app push is limited
 * to one a day per group and person), so it is aimed at the group holding the
 * most of what they owe — while the message itself carries the whole amount and
 * names every group it is made up of.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { View } from 'react-native';

import { format, money, type CurrencyCode } from '@waves/core';
import { Button, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { useGroup } from '@/data/hooks';
import { directionGroups, type CurrencyTotal } from '@/lib/friendsTotals';
import { fill, useStrings } from '@/i18n';
import { useRemind } from '@/lib/useRemind';
import type { PairGroupRow } from '@/lib/usePairPerson';

const WALLET_ART = require('../../../assets/images/settle-wallet.webp') as number;

export function OwesCard({
  name,
  totals,
  groups,
  canAct,
  onSettle,
}: {
  name: string;
  totals: readonly CurrencyTotal[];
  groups: readonly PairGroupRow[];
  /** False while the person is blocked (or the block list has not loaded). */
  canAct: boolean;
  onSettle: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const directions = directionGroups(totals);
  const lead = directions[0];
  if (!lead) return null;

  return (
    <View
      style={{
        backgroundColor: theme.color.brandSoft,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
        overflow: 'hidden',
      }}
    >
      {/* The wallet is decoration, tucked into the corner behind the figure. */}
      <Image
        source={WALLET_ART}
        contentFit="contain"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: 'absolute',
          end: -8,
          top: 0,
          width: 120,
          height: 96,
          opacity: theme.scheme === 'dark' ? 0.5 : 0.9,
        }}
      />
      {directions.map((direction) => (
        <View key={direction.owed ? 'owed' : 'owing'} style={{ gap: 2 }}>
          <Text variant="subheading">{direction.owed ? t.tabs.owesYou : t.tabs.youOweThem}</Text>
          <MoneyText
            amount={direction.head.net}
            currency={direction.head.currency as CurrencyCode}
            locale={locale}
            variant="title"
            style={{ fontSize: 30, lineHeight: 36 }}
            mode="balance"
            numberOfLines={1}
          />
          {direction.rest.length > 0 ? (
            <Row style={{ flexWrap: 'wrap', columnGap: theme.spacing.sm }}>
              {direction.rest.map((total) => (
                <MoneyText
                  key={total.currency}
                  amount={total.net}
                  currency={total.currency as CurrencyCode}
                  locale={locale}
                  variant="caption"
                  mode="balance"
                  numberOfLines={1}
                />
              ))}
            </Row>
          ) : null}
        </View>
      ))}
      {canAct ? (
        lead.owed ? (
          <RemindZone name={name} head={lead.head} groups={groups} onSettle={onSettle} />
        ) : (
          <Button
            variant="brand"
            size="sm"
            label={t.settleUp}
            accessibilityLabel={fill(t.person.settleUpA11y, { name })}
            icon={<Ionicons name="send-outline" size={iconSize.sm} color={theme.color.onBrand} />}
            onPress={onSettle}
          />
        )
      ) : null}
    </View>
  );
}

/** Remind and Settle up side by side, with the reminder's verdict under them. */
function RemindZone({
  name,
  head,
  groups,
  onSettle,
}: {
  name: string;
  head: CurrencyTotal;
  groups: readonly PairGroupRow[];
  onSettle: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();

  // The groups where they owe you in the headline currency, biggest first.
  const owing = groups
    .flatMap((group) => {
      const line = group.lines.find((candidate) => candidate.currency === head.currency);
      return line && line.net > 0n ? [{ group, amount: line.net }] : [];
    })
    .sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1));
  const target = owing[0]?.group ?? null;
  const { group: groupQuery, members } = useGroup(target?.groupId ?? '');
  const member = members.data?.find((candidate) => candidate.id === target?.otherMemberId);

  const remind = useRemind({
    groupId: target?.groupId ?? '',
    memberId: member?.id ?? '',
    currency: head.currency,
    joined: Boolean(member?.profile_id),
    phone: member?.invite_phone ?? null,
    joinToken: groupQuery.data?.join_token ?? null,
    name,
    groupName: owing.map((entry) => entry.group.name).join(', '),
    amountText: format(money(head.net, head.currency as CurrencyCode), { locale }),
  });
  const canRemind = Boolean(target && member);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Row style={{ gap: theme.spacing.sm }}>
        {canRemind && !remind.reminded ? (
          <View style={{ flex: 1 }}>
            <Button
              variant="brand"
              label={t.people.remind}
              accessibilityLabel={fill(t.person.remindA11y, { name })}
              icon={
                <Ionicons
                  name="notifications-outline"
                  size={iconSize.md}
                  color={theme.color.onBrand}
                />
              }
              disabled={remind.pending}
              onPress={remind.open}
            />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button
            variant="secondary"
            label={t.settleUp}
            accessibilityLabel={fill(t.person.settleUpA11y, { name })}
            icon={<Ionicons name="send-outline" size={iconSize.md} color={theme.color.brand} />}
            onPress={onSettle}
          />
        </View>
      </Row>
      {remind.sheet}
      {remind.outcome ? (
        <Text
          variant="caption"
          tone={remind.outcome.ok ? 'positive' : 'negative'}
          accessibilityLiveRegion="polite"
        >
          {remind.outcome.label}
        </Text>
      ) : remind.reminded ? (
        <Text variant="caption" tone="positive" accessibilityLiveRegion="polite">
          {t.people.reminded}
        </Text>
      ) : null}
    </View>
  );
}
