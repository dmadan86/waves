/**
 * Who pays whom, between you and one person.
 *
 * Opened from "Settle up" on their screen, and drawn from the very same
 * `pairBalances` result (through `usePairPerson`), so the total here is the total
 * there: every group's amount added together, never a figure of this screen's
 * own. A group with Simplify on shows the payment its plan asks for and says so
 * ("after simplifying"); every other group shows the direct balance. Each group
 * contributes one or the other, never a blend of the two.
 *
 * A settlement is recorded against one group's ledger, so "Settle up" opens that
 * group's own settle screen — the existing record-settlement flow — and with
 * several groups first asks which one to settle, one at a time.
 */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  directionalIcon,
  Card,
  iconSize,
  MoneyText,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';
import type { CurrencyCode } from '@waves/core';

import { PeopleSkeleton } from '@/components/Skeletons';
import {
  Chevron,
  HERO_TEXT_SHADOW,
  HeroCircleButton,
  NavRow,
  PairGroupCard,
  PairHero,
  PairSheet,
  PickGroupSheet,
} from '@/components/person/pairParts';
import { directionGroups, type CurrencyTotal } from '@/lib/friendsTotals';
import { fill, plural, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { usePairPerson, type PairGroupRow } from '@/lib/usePairPerson';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useViewerIdentity } from '@/lib/viewerIdentity';

export default function PairSettleScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { key, name } = useLocalSearchParams<{ key: string; name?: string }>();
  const person = usePairPerson(key ?? '', name);
  const me = useViewerIdentity();
  const { groups, totals, title, photo, masked } = person;
  const [pick, setPick] = useState<{ groups: PairGroupRow[]; to: 'settle' | 'history' } | null>(
    null,
  );

  const directions = directionGroups(totals);
  const lead = directions[0];
  const owingGroups = groups.filter((group) => group.lines.length > 0);

  // Which way the money runs, for the arrow under the title: from the payer
  // to the payee, whoever the headline says that is.
  const theyPay = lead ? lead.owed : true;

  const simplifyOn = groups.filter((group) => group.simplify).length;
  const simplifyTitle =
    simplifyOn === 0
      ? t.simplifyOff
      : simplifyOn === groups.length
        ? t.simplifyOn
        : fill(t.person.simplifyMixed, { on: simplifyOn, all: groups.length });
  const payments = lead
    ? owingGroups.filter((group) =>
        group.lines.some((line) => line.currency === lead.head.currency),
      ).length
    : 0;

  const settleIn = (group: PairGroupRow): void => router.push(`/group/${group.groupId}/settle`);
  const settleGroups = (list: PairGroupRow[]): void => {
    const [only] = list;
    if (list.length === 1 && only) settleIn(only);
    else setPick({ groups: list, to: 'settle' });
  };
  const openLedger = (): void => {
    const [only] = groups;
    if (groups.length === 1 && only) settleIn(only);
    else setPick({ groups, to: 'history' });
  };

  return (
    <Screen edges={[]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <PairHero>
          <Row style={{ alignItems: 'center' }}>
            <HeroCircleButton
              icon="chevron-back"
              label={t.common.back}
              onPress={() => router.back()}
            />
          </Row>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text
              variant="title"
              accessibilityRole="header"
              style={{ color: '#FFFFFF', ...HERO_TEXT_SHADOW }}
            >
              {t.whoPaysWhom}
            </Text>
            <Text
              variant="body"
              numberOfLines={1}
              style={{ color: '#FFFFFF', ...HERO_TEXT_SHADOW }}
            >
              {fill(t.person.pairSubtitle, { name: title })}
            </Text>
          </View>
          <Row
            style={{ alignItems: 'flex-start', justifyContent: 'center', gap: theme.spacing.lg }}
          >
            <PairAvatar label={t.person.you}>
              <PersonAvatar
                name={t.person.you}
                size={52}
                avatarUrl={me.avatarUrl}
                mark={(color) => <Ionicons name="person" size={iconSize.xl} color={color} />}
              />
            </PairAvatar>
            <View style={{ height: 52, justifyContent: 'center' }}>
              <Ionicons
                name={directionalIcon(theyPay ? 'arrow-back' : 'arrow-forward')}
                size={iconSize.xxl}
                color="#FFFFFF"
                accessibilityElementsHidden
              />
            </View>
            <PairAvatar label={title}>
              <PersonAvatar
                name={masked ? t.misc.someone : title}
                size={52}
                avatarUrl={photo}
                ghost={masked || person.unregistered}
              />
            </PairAvatar>
          </Row>
        </PairHero>

        <PairSheet>
          {person.loading ? (
            <PeopleSkeleton />
          ) : (
            <>
              <Card
                style={{
                  flexDirection: 'row',
                  gap: theme.spacing.md,
                  padding: theme.spacing.md,
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.color.surface,
                  }}
                >
                  <Ionicons name="bulb-outline" size={iconSize.xl} color={theme.color.brand} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Row
                    style={{
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: theme.spacing.sm,
                    }}
                  >
                    <Text variant="subheading" tone="brand" style={{ flexShrink: 1 }}>
                      {simplifyTitle}
                    </Text>
                    {payments > 0 ? (
                      <View
                        style={{
                          paddingHorizontal: theme.spacing.sm,
                          paddingVertical: 2,
                          borderRadius: theme.radius.pill,
                          backgroundColor: theme.color.surface,
                        }}
                      >
                        <Text variant="micro" tone="brand">
                          {plural(locale, payments, t.simplifyPaymentsCount)}
                        </Text>
                      </View>
                    ) : null}
                  </Row>
                  <Text variant="caption" tone="muted">
                    {simplifyOn > 0 ? t.simplifySuggestBody : t.simplifyPairwiseBody}
                  </Text>
                </View>
              </Card>

              {directions.length === 0 ? (
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <Ionicons
                    name="checkmark-circle"
                    size={iconSize.xl}
                    color={theme.color.positive}
                  />
                  <Text style={{ flex: 1 }}>
                    {owingGroups.length > 0 ? t.person.squareOverall : t.allSettled}
                  </Text>
                </Card>
              ) : (
                <>
                  <Text variant="heading" style={{ marginTop: theme.spacing.xs }}>
                    {t.settleUp}
                  </Text>
                  {directions.map((direction) => {
                    const here = owingGroups.filter((group) =>
                      group.lines.some(
                        (line) =>
                          line.currency === direction.head.currency &&
                          line.net > 0n === direction.owed,
                      ),
                    );
                    return (
                      <SettleCard
                        key={direction.owed ? 'owed' : 'owing'}
                        name={title}
                        owed={direction.owed}
                        total={direction.head}
                        rest={direction.rest}
                        single={here.length <= 1}
                        avatar={
                          <PersonAvatar
                            name={masked ? t.misc.someone : title}
                            size={44}
                            avatarUrl={photo}
                            ghost={masked || person.unregistered}
                          />
                        }
                        onPress={() => settleGroups(here)}
                      />
                    );
                  })}
                  {owingGroups.length > 0 ? <OrDivider label={t.person.or} /> : null}
                </>
              )}

              {owingGroups.length > 0 ? (
                <>
                  <Text variant="heading">{t.person.viewDetails}</Text>
                  {owingGroups.map((group) => (
                    <PairGroupCard
                      key={group.groupId}
                      group={group}
                      onPress={() => settleIn(group)}
                    />
                  ))}
                </>
              ) : null}

              {groups.length > 0 ? (
                <Card
                  style={{ paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.md }}
                >
                  <NavRow
                    icon="document-text-outline"
                    title={t.person.fullLedger}
                    body={fill(t.person.fullLedgerBody, { name: title })}
                    onPress={openLedger}
                  />
                </Card>
              ) : null}
            </>
          )}
        </PairSheet>
      </ScrollView>

      <PickGroupSheet
        visible={pick !== null}
        onClose={() => setPick(null)}
        groups={pick?.groups ?? []}
        name={title}
        onPick={(group) => {
          setPick(null);
          settleIn(group);
        }}
      />
    </Screen>
  );
}

/** An avatar with its name under it, on the scene. */
function PairAvatar({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', gap: 2, maxWidth: 120 }}>
      {children}
      <Text variant="caption" numberOfLines={1} style={{ color: '#FFFFFF', ...HERO_TEXT_SHADOW }}>
        {label}
      </Text>
    </View>
  );
}

/** The payment to make: who pays whom, the amount, and the way in. */
function SettleCard({
  name,
  owed,
  total,
  rest,
  single,
  avatar,
  onPress,
}: {
  name: string;
  owed: boolean;
  total: CurrencyTotal;
  rest: readonly CurrencyTotal[];
  /** One group makes up the amount; several are settled one at a time. */
  single: boolean;
  avatar: React.ReactNode;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const sentence = owed ? fill(t.namePaysYou, { name }) : fill(t.youPayName, { name });
  const sub = single ? t.person.settlePayment : t.person.settleOneByOne;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sentence}. ${sub}`}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.8 : 1,
        backgroundColor: theme.color.brandSoft,
        borderRadius: theme.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.color.border,
        padding: theme.spacing.md,
      })}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        {avatar}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subheading" numberOfLines={2}>
            {sentence}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {sub}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', maxWidth: '40%' }}>
          <MoneyText
            amount={total.net}
            currency={total.currency as CurrencyCode}
            locale={locale}
            variant="heading"
            mode="balance"
            numberOfLines={1}
          />
          {rest.map((line) => (
            <MoneyText
              key={line.currency}
              amount={line.net}
              currency={line.currency as CurrencyCode}
              locale={locale}
              variant="caption"
              mode="balance"
              numberOfLines={1}
            />
          ))}
        </View>
        <Chevron />
      </Row>
    </Pressable>
  );
}

function OrDivider({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <View
        style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.color.border }}
      />
      <View
        style={{
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 2,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color.surfaceMuted,
        }}
      >
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      </View>
      <View
        style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.color.border }}
      />
    </Row>
  );
}
