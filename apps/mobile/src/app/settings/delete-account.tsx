import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  Button,
  Callout,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { deleteMyAccount, erasurePreview } from '@/data/api';
import { plural, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { forgetTours } from '@/lib/onboardingSeen';

/**
 * Leaving, with the consequence in view before the button.
 *
 * The screen leads with what does *not* go, because that is the part people do
 * not expect: expenses in a shared group are also other people's records, and
 * removing them would silently change somebody else's balance to settle a debt
 * nobody paid. Saying so first is the difference between a promise the app can
 * keep and one it cannot.
 *
 * Export sits above the confirmation on purpose. Somebody who has decided to
 * leave should be offered their data on the way out rather than reminded of it
 * afterwards.
 */
export default function DeleteAccountScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { session, signOut } = useAuth();

  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const preview = useQuery({ queryKey: ['erasure-preview'], queryFn: erasurePreview });

  const armed = confirm.trim().toUpperCase() === t.privacy.deleteConfirmWord;

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteMyAccount(reason.trim() || null);
      // The device's own note of which tours this account had seen. Erasure is
      // the one moment it is meaningless — there is no account left to have
      // seen anything — and the last moment we still know the id to look it up
      // by. It never rejects, so it cannot come between the deletion and the
      // sign-out below.
      const ownerId = session?.user.id;
      if (ownerId) await forgetTours(ownerId);
      // Signing out is the last thing, and only after the data is gone: the
      // reverse order would leave somebody signed out of an account that still
      // holds everything, with no way back in to try again.
      //
      // A failure here is its own report: the data is already gone, so the
      // screen must not claim success while the session is still live.
      await signOut();
      setDone(plural(locale, result.memberships_anonymised ?? 0, t.privacy.deleteSummary));
    } catch (caught) {
      setError(friendlyError(caught, t.privacy.couldNotSave, 'account.delete'));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xxxl, gap: 16 }}>
          <Text variant="title" align="center">
            {t.privacy.deleteDone}
          </Text>
          <Text variant="caption" tone="muted" align="center">
            {done}
          </Text>
        </View>
      </Screen>
    );
  }

  const data = preview.data;
  const stats: {
    icon: keyof typeof Ionicons.glyphMap;
    tint: 'lilac' | 'mint' | 'peach' | 'pink';
    value: string;
    label: string;
    detail?: string;
  }[] = data
    ? [
        {
          icon: 'people-outline',
          tint: 'lilac',
          value: String(data.groups_count),
          label: t.deleteForm.statGroups,
        },
        {
          icon: 'document-text-outline',
          tint: 'mint',
          value: String(data.expenses_authored),
          label: t.deleteForm.statExpenses,
        },
        {
          icon: 'swap-horizontal',
          tint: 'peach',
          value: String(data.settlements_involved),
          label: t.deleteForm.statSettlements,
        },
        ...(data.outstanding_currencies.length > 0
          ? [
              {
                icon: 'cash-outline' as const,
                tint: 'pink' as const,
                value: plural(
                  locale,
                  data.outstanding_currencies.length,
                  t.deleteForm.statCurrencies,
                ),
                label: t.deleteForm.statUnsettled,
                detail: data.outstanding_currencies.join(', '),
              },
            ]
          : []),
      ]
    : [];

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.privacy.deleteTitle}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          paddingTop: theme.spacing.sm,
          gap: theme.spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* The warning, with a basket of your things and a shield drawn beside it. */}
        <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <Text
              style={{ fontSize: 24, lineHeight: 29, fontWeight: '800', color: theme.color.text }}
            >
              {t.deleteForm.heroTitle}
            </Text>
            <Text variant="caption" tone="muted" style={{ lineHeight: 19 }}>
              {t.privacy.deleteIntro}
            </Text>
          </View>
          <BasketArt />
        </Row>

        {/* What stays comes first: it is the surprising half. */}
        <Card style={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
          <SectionHead
            icon="people-outline"
            tint={theme.tint.mint}
            title={t.privacy.deleteStaysTitle}
            pill={t.deleteForm.staysPill}
          />
          <Text variant="caption" tone="muted" style={{ lineHeight: 19 }}>
            {t.privacy.deleteStaysBody}
          </Text>
          {/* Labelled, because the first version of this rendered as "1 · 3 · 0
              · INR" — four numbers with nothing saying what any of them
              counted, on the screen where somebody is deciding whether to
              erase themselves. */}
          {stats.length > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                rowGap: theme.spacing.md,
                padding: theme.spacing.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F6F5FB',
              }}
            >
              {stats.map((stat) => (
                <Row key={stat.label} style={{ width: '50%', gap: theme.spacing.sm }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: theme.tint[stat.tint].bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons
                      name={stat.icon}
                      size={iconSize.md}
                      color={theme.tint[stat.tint].ink}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" style={{ fontWeight: '800' }} numberOfLines={1}>
                      {stat.value}
                    </Text>
                    <Text variant="micro" tone="muted">
                      {stat.label}
                    </Text>
                    {stat.detail ? (
                      <Text variant="micro" tone="negative" style={{ fontWeight: '700' }}>
                        {stat.detail}
                      </Text>
                    ) : null}
                  </View>
                </Row>
              ))}
            </View>
          ) : null}
        </Card>

        <Card
          style={{
            padding: theme.spacing.md,
            gap: theme.spacing.md,
            backgroundColor: theme.scheme === 'dark' ? theme.color.surface : '#FFF6F7',
          }}
        >
          <SectionHead
            icon="trash-outline"
            tint={theme.tint.pink}
            title={t.privacy.deleteGoesTitle}
            pill={t.deleteForm.goesPill}
            danger
          />
          <Text variant="caption" tone="muted" style={{ lineHeight: 19 }}>
            {t.privacy.deleteGoesBody}
          </Text>
          <Row
            style={{
              gap: theme.spacing.sm,
              padding: theme.spacing.md,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="information-circle" size={iconSize.md} color={theme.color.brand} />
            <Text variant="caption" tone="brand" style={{ flex: 1, fontWeight: '600' }}>
              {t.deleteForm.cannotRecover}
            </Text>
          </Row>

          {/* Export first, on the way out rather than as an afterthought. */}
          <Button
            label={t.privacy.deleteExportFirst}
            variant="secondary"
            onPress={() => router.push('/settings/export')}
          />

          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={t.privacy.deleteWhyPlaceholder}
            placeholderTextColor={theme.color.textFaint}
            accessibilityLabel={t.privacy.deleteWhyLabel}
            multiline
            maxLength={4000}
            style={{
              minHeight: 64,
              fontSize: 15,
              color: theme.color.text,
              textAlignVertical: 'top',
              padding: theme.spacing.md,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: theme.color.surface,
            }}
          />

          {/* The typed word stays: one tap must never erase an account. */}
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="caption" tone="muted">
              {t.privacy.deleteConfirmLabel}
            </Text>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder={t.privacy.deleteConfirmWord}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.privacy.deleteConfirmLabel}
              autoCapitalize="characters"
              autoCorrect={false}
              style={{
                height: 48,
                fontSize: 17,
                fontWeight: '700',
                color: theme.color.text,
                paddingHorizontal: theme.spacing.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: armed ? theme.color.negative : theme.color.border,
                backgroundColor: theme.color.surface,
              }}
            />
          </View>

          {error ? <Callout tone="negative">{error}</Callout> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? t.privacy.deleteWorking : t.privacy.deleteButton}
            accessibilityState={{ disabled: !armed || busy }}
            disabled={!armed || busy}
            onPress={() => void run()}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.sm,
              minHeight: 54,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.negative,
              opacity: !armed || busy ? 0.45 : pressed ? 0.85 : 1,
            })}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Ionicons name="trash-outline" size={iconSize.lg} color="#FFFFFF" />
            )}
            <Text variant="subheading" style={{ color: '#FFFFFF', fontWeight: '700' }}>
              {busy ? t.privacy.deleteWorking : t.privacy.deleteButton}
            </Text>
          </Pressable>
        </Card>
      </ScrollView>
    </Screen>
  );
}

/** A card's head: a tinted disc, the title, and a small pill saying the verdict. */
function SectionHead({
  icon,
  tint,
  title,
  pill,
  danger = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: { bg: string; ink: string };
  title: string;
  pill: string;
  danger?: boolean;
}) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: tint.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={tint.ink} />
      </View>
      <Text variant="subheading" style={{ flex: 1 }} numberOfLines={2}>
        {title}
      </Text>
      <View
        style={{
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 3,
          borderRadius: theme.radius.pill,
          backgroundColor: danger ? theme.color.negativeSoft : theme.color.positiveSoft,
        }}
      >
        <Text
          variant="micro"
          style={{
            fontWeight: '700',
            color: danger ? theme.color.negative : theme.color.positive,
          }}
        >
          {pill}
        </Text>
      </View>
    </Row>
  );
}

/**
 * The warning's picture: a brand basket holding a profile card and a photo,
 * with a red shield at its front, drawn from views. Decoration only.
 */
function BasketArt() {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: 104, height: 96 }}
    >
      <View
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 48,
          backgroundColor: theme.color.negativeSoft,
          opacity: 0.6,
        }}
      />
      <View
        style={{
          position: 'absolute',
          start: 26,
          top: 6,
          width: 44,
          height: 54,
          borderRadius: 8,
          backgroundColor: theme.color.surface,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: '-8deg' }],
        }}
      >
        <Ionicons name="person" size={22} color={theme.color.brand} />
      </View>
      <View
        style={{
          position: 'absolute',
          start: 16,
          bottom: 8,
          width: 72,
          height: 40,
          borderBottomLeftRadius: 14,
          borderBottomRightRadius: 14,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          backgroundColor: theme.color.brand,
        }}
      />
      <View
        style={{
          position: 'absolute',
          end: 6,
          bottom: 0,
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: theme.color.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="shield" size={20} color={theme.color.negative} />
      </View>
    </View>
  );
}
