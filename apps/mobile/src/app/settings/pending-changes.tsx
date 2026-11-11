import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { blockedBy, isStaleOverlay, type QueuedMutation } from '@waves/core';
import {
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { IconDisc } from '@/components/company/dashboard/overviewKit';
import { StandardCard } from '@/components/standard';
import { plural, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';
import { useSync } from '@/sync';

const short = (id: string) => id.slice(0, 8);

/** What the change is about: a title if the payload has one, else the entity id's first 8 characters. */
function targetOf(item: QueuedMutation): string {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  for (const key of ['title', 'description', 'name']) {
    if (typeof p[key] === 'string' && p[key]) return p[key] as string;
  }
  for (const key of ['taskId', 'docId', 'expenseId', 'recordId', 'captureId', 'tagId', 'itemId']) {
    if (typeof p[key] === 'string') return short(p[key] as string);
  }
  return short(item.groupId);
}

/**
 * Every change waiting in this phone's queue, and why. An explicit diagnostic:
 * plain technical detail is fine here, unlike the rest of the app.
 */
export default function PendingChangesScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { queue, retry, discard } = useSync();
  const { confirm } = useDialog();
  const [copied, setCopied] = useState(false);

  // Taken once when the screen opens; reopening refreshes "stuck" (render must stay pure).
  const [now] = useState(() => Date.now());
  const ordered = [...queue].sort((a, b) => a.seq - b.seq);
  const blockers = blockedBy(queue, { now });
  const view = ordered.map((item) => ({
    item,
    blocker: blockers.get(item.clientMutationId) ?? null,
    stuck: isStaleOverlay(item, now),
    error: item.rejection ? `${item.rejection.code}: ${item.rejection.message}` : item.lastError,
  }));

  const copyReport = async () => {
    // No payloads, no titles: kinds, short ids, times and errors only.
    const report = {
      at: new Date(now).toISOString(),
      count: view.length,
      changes: view.map(({ item, blocker, stuck, error }) => ({
        id: short(item.clientMutationId),
        kind: item.kind,
        group: short(item.groupId),
        created: item.clientCreatedAt,
        attempts: item.attempts,
        nextAttemptAt: item.nextAttemptAt ? new Date(item.nextAttemptAt).toISOString() : null,
        error: error ?? null,
        refused: Boolean(item.rejection),
        stuck,
        blockedBy: blocker ? { id: short(blocker.clientMutationId), kind: blocker.kind } : null,
      })),
    };
    await Clipboard.setStringAsync(JSON.stringify(report, null, 2));
    setCopied(true);
  };

  const letGo = async (item: QueuedMutation) => {
    const ok = await confirm({
      title: t.pendingChanges.discardTitle,
      body: t.pendingChanges.discardBody,
      confirmLabel: t.pendingChanges.discard,
      tone: 'danger',
    });
    if (ok) void discard(item.clientMutationId);
  };

  const p = t.pendingChanges;
  const red = theme.color.negative;
  const brand = theme.color.brand;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const detail = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    value: string,
    bad = false,
  ) => (
    <Row key={label} style={{ gap: theme.spacing.sm, minHeight: 32 }}>
      <Ionicons name={icon} size={iconSize.base} color={bad ? red : theme.color.textMuted} />
      <Text variant="body" numberOfLines={1} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text
        variant="body"
        selectable
        numberOfLines={2}
        style={{ flex: 1, textAlign: 'right', color: bad ? red : theme.color.text }}
      >
        {value}
      </Text>
    </Row>
  );
  const action = (
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    solid: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 48,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: solid ? brand : theme.color.brandSoft,
      }}
    >
      <Ionicons name={icon} size={iconSize.base} color={solid ? theme.color.onBrand : brand} />
      <Text
        variant="body"
        style={{ fontWeight: '700', color: solid ? theme.color.onBrand : brand }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {p.row}
        </Text>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 112,
              height: 112,
              borderRadius: 56,
              backgroundColor: theme.color.brandSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="cloud" size={72} color={brand} />
            <View style={{ position: 'absolute' }}>
              <Ionicons name="sync" size={30} color={theme.color.onBrand} />
            </View>
            <View
              style={{
                position: 'absolute',
                end: 12,
                bottom: 14,
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: view.length === 0 ? theme.color.positive : red,
              }}
            >
              <Ionicons
                name={view.length === 0 ? 'checkmark' : 'alert'}
                size={18}
                color="#FFFFFF"
              />
            </View>
          </View>
          <Text variant="title" align="center" style={{ fontWeight: '800' }}>
            {view.length === 0 ? p.allSynced : plural(locale, view.length, p.headline)}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {view.length === 0 ? p.empty : p.intro}
          </Text>
        </View>

        {view.map(({ item, blocker, stuck, error }) => (
          <StandardCard key={item.clientMutationId} style={{ gap: theme.spacing.sm }}>
            <Row style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
              <IconDisc ink={brand} size={44}>
                <Ionicons name="document-outline" size={iconSize.md} color={brand} />
              </IconDisc>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" style={{ fontWeight: '800' }} numberOfLines={1}>
                  {item.kind}
                </Text>
                <Text variant="caption" tone="muted" selectable numberOfLines={2}>
                  {short(item.groupId)} · {targetOf(item)}
                </Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 12,
                  backgroundColor: blocker ? theme.color.surfaceMuted : `${red}1A`,
                }}
              >
                <Text
                  variant="micro"
                  style={{ fontWeight: '700', color: blocker ? theme.color.textMuted : red }}
                >
                  {blocker ? p.waiting : p.notSynced}
                </Text>
              </View>
            </Row>
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.color.border,
                paddingTop: theme.spacing.sm,
              }}
            >
              {detail('calendar-outline', p.created, when(item.clientCreatedAt))}
              {detail('sync-outline', p.attempts, String(item.attempts))}
              {error ? detail('alert-circle-outline', p.lastError, error, true) : null}
              {blocker
                ? detail(
                    'pause-circle-outline',
                    p.blockedBy,
                    `${blocker.kind} · ${short(blocker.clientMutationId)}`,
                  )
                : null}
              {stuck ? detail('layers-outline', p.status, p.stuckShort, true) : null}
            </View>
            <Row style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.xs }}>
              {action(p.retry, 'sync', true, () => void retry(item.clientMutationId))}
              {action(p.discard, 'trash-outline', false, () => void letGo(item))}
            </Row>
          </StandardCard>
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={p.copy}
          onPress={() => void copyReport()}
        >
          <StandardCard>
            <Row style={{ gap: theme.spacing.md }}>
              <IconDisc ink={brand} size={44}>
                <Ionicons name="document-text-outline" size={iconSize.md} color={brand} />
              </IconDisc>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" style={{ fontWeight: '800' }}>
                  {p.copy}
                </Text>
                <Text variant="caption" tone="muted">
                  {copied ? p.copied : p.copyHint}
                </Text>
              </View>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.md}
                color={theme.color.textMuted}
              />
            </Row>
          </StandardCard>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
