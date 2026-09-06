/**
 * One pack: everything in it, and the two buttons that matter.
 *
 * Installing writes the categories into the person's own catalog as ordinary
 * custom tags — so they can be renamed, recoloured, hidden or deleted like any
 * other, and an expense filed under one carries its label as a snapshot. That is
 * what lets the uninstall copy say, truthfully, that the categories stay.
 *
 * Every chip below is drawn from the pack's own icon and tint, so what somebody
 * sees here is exactly what they are agreeing to add.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, View } from 'react-native';

import type { PackEntry } from '@waves/core';
import {
  Button,
  Card,
  directionalIcon,
  Divider,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useScreenClearance,
  useTheme,
} from '@waves/ui';

import { useInstallPack, useInstalledPacks, usePacks, useUninstallPack } from '@/data/packs';
import { plural, useStrings } from '@/i18n';

export default function PackScreen() {
  const theme = useTheme();
  const clearance = useScreenClearance();
  const { t, locale } = useStrings();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const packs = usePacks();
  const installed = useInstalledPacks();
  const install = useInstallPack();
  const uninstall = useUninstallPack();
  const [added, setAdded] = useState<number | null>(null);

  const pack = (packs.data ?? []).find((candidate) => candidate.slug === slug) ?? null;
  const record = pack ? (installed.find((row) => row.packId === pack.id) ?? null) : null;

  if (!pack) {
    return (
      <Screen>
        <Header title={t.packs.title} />
        <View style={{ paddingTop: theme.spacing.xxxl }}>
          <EmptyState
            title={packs.isLoading ? t.common.loading : t.packs.notFound}
            body={packs.isError ? t.packs.offline : undefined}
          />
        </View>
      </Screen>
    );
  }

  const spending = pack.entries.filter((entry) => entry.axis === 'expense');
  const income = pack.entries.filter((entry) => entry.axis === 'income');

  const onInstall = (): void => {
    install.mutate(pack, { onSuccess: (count) => setAdded(count) });
  };

  const onUninstall = (): void => {
    if (!record) return;
    Alert.alert(t.packs.uninstallTitle, t.packs.uninstallBody, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.packs.uninstall,
        style: 'destructive',
        onPress: () => uninstall.mutate(record.installId, { onSuccess: () => setAdded(null) }),
      },
    ]);
  };

  return (
    <Screen>
      <Header title={pack.title} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="body" tone="muted">
          {pack.summary}
        </Text>

        {spending.length > 0 ? <Section title={t.packs.expenseSide} entries={spending} /> : null}
        {income.length > 0 ? <Section title={t.packs.incomeSide} entries={income} /> : null}

        <Text variant="micro" tone="faint" align="center">
          {plural(locale, pack.entries.length, t.packs.includes)}
        </Text>

        {/* What actually happened, said in the number that is true: installing a
            pack you mostly have adds the few that are new, and saying "12 added"
            when two were would be a small lie the person can see through. */}
        {added !== null ? (
          <Text variant="caption" tone="positive" align="center">
            {added > 0 ? plural(locale, added, t.packs.added) : t.packs.alreadyHave}
          </Text>
        ) : null}

        {record ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Row style={{ gap: theme.spacing.xs, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="checkmark-circle" size={iconSize.md} color={theme.color.positive} />
              <Text variant="caption" tone="positive">
                {t.packs.installed}
              </Text>
            </Row>
            <Button
              label={t.packs.uninstall}
              variant="secondary"
              fullWidth
              onPress={onUninstall}
              disabled={uninstall.isPending}
            />
            <Text variant="micro" tone="faint" align="center">
              {t.packs.uninstallBody}
            </Text>
          </View>
        ) : (
          <Button
            label={install.isPending ? t.packs.installing : t.packs.install}
            size="lg"
            fullWidth
            onPress={onInstall}
            disabled={install.isPending}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

function Header({ title }: { title: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Row
      style={{
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.sm,
        alignItems: 'center',
      }}
    >
      <IconButton label={t.common.back} onPress={() => router.back()}>
        <Ionicons
          name={directionalIcon('chevron-back')}
          size={iconSize.lg}
          color={theme.color.text}
        />
      </IconButton>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text variant="heading" numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={{ width: iconSize.lg + theme.spacing.md }} />
    </Row>
  );
}

/** One side of the pack — what it adds to spending, or to income. */
function Section({ title, entries }: { title: string; entries: readonly PackEntry[] }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.md }}>
      <Text variant="caption" tone="muted">
        {title}
      </Text>
      <Divider />
      {entries.map((entry) => (
        <Row key={entry.key} style={{ gap: theme.spacing.md, alignItems: 'center' }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.tint[entry.tint].bg,
            }}
          >
            <Ionicons
              name={entry.icon as keyof typeof Ionicons.glyphMap}
              size={iconSize.md}
              color={theme.tint[entry.tint].ink}
            />
          </View>
          <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
            {entry.label}
          </Text>
        </Row>
      ))}
    </Card>
  );
}
