import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { blockedBy, isStaleOverlay, type QueuedMutation } from '@waves/core';
import {
  Button,
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

import { useStrings } from '@/i18n';
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
  for (const key of ['taskId', 'expenseId', 'recordId', 'captureId', 'tagId', 'itemId']) {
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
  const { t } = useStrings();
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
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.pendingChanges.row}</Text>
        </View>
        <View style={{ width: 44 }} />
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
        <Text variant="body" tone="muted">
          {view.length === 0 ? t.pendingChanges.empty : t.pendingChanges.intro}
        </Text>

        {view.map(({ item, blocker, stuck, error }) => (
          <Card key={item.clientMutationId} style={{ gap: theme.spacing.xs }}>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {item.kind}
            </Text>
            <Text variant="caption" tone="muted" selectable numberOfLines={2}>
              {targetOf(item)} · {short(item.clientMutationId)}
            </Text>
            <Text variant="caption" tone="muted">
              {t.pendingChanges.created}: {item.clientCreatedAt} · {t.pendingChanges.attempts}:{' '}
              {item.attempts}
            </Text>
            {error ? (
              <Text variant="caption" tone="negative" selectable>
                {t.pendingChanges.lastError}: {error}
              </Text>
            ) : null}
            {blocker ? (
              <Text variant="caption" tone="muted" selectable>
                {t.pendingChanges.blockedBy}: {blocker.kind} · {short(blocker.clientMutationId)}
              </Text>
            ) : null}
            {stuck ? (
              <Text variant="caption" tone="negative">
                {t.pendingChanges.stuck}
              </Text>
            ) : null}
            <Row style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={t.pendingChanges.retry}
                  variant="secondary"
                  onPress={() => void retry(item.clientMutationId)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={t.pendingChanges.discard}
                  variant="secondary"
                  onPress={() => void letGo(item)}
                />
              </View>
            </Row>
          </Card>
        ))}

        <Button
          label={t.pendingChanges.copy}
          variant="secondary"
          onPress={() => void copyReport()}
        />
        {copied ? (
          <Text variant="caption" tone="muted">
            {t.pendingChanges.copied}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
