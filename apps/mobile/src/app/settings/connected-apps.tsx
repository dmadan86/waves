/**
 * The AI assistants this account has authorised, and the switch that ends one.
 *
 * Reached from Settings -> Security. Disconnecting revokes consent on the auth
 * server, which also deletes that assistant's sessions and refresh tokens, so
 * the row only leaves the list once the server has said yes.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Image, Linking, RefreshControl, ScrollView, View } from 'react-native';

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
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import {
  CONNECT_GUIDE_URL,
  disconnectApp,
  listConnectedApps,
  withoutApp,
  type ConnectedApp,
} from '@/lib/connectedApps';
import { backend } from '@/lib/backend';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';

const QUERY_KEY = ['connected-apps'] as const;

export default function ConnectedAppsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const queryClient = useQueryClient();
  const { confirm } = useDialog();

  const apps = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => listConnectedApps(backend.auth.oauth),
  });
  const rows = apps.data ?? [];
  // A failed fetch with nothing cached is not an empty list: saying "no
  // connected apps" about a list that was never read would be a false comfort.
  const failed = apps.isError && !apps.data;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const onPull = () => {
    setPulling(true);
    void apps.refetch().finally(() => setPulling(false));
  };

  async function onDisconnect(app: ConnectedApp) {
    const name = app.name || t.connectedApps.unnamed;
    const ok = await confirm({
      title: fill(t.connectedApps.confirmTitle, { name }),
      body: t.connectedApps.confirmBody,
      confirmLabel: t.connectedApps.disconnect,
      tone: 'danger',
    });
    if (!ok) return;
    setBusyId(app.clientId);
    setMessage(null);
    try {
      await disconnectApp(backend.auth.oauth, app.clientId);
      queryClient.setQueryData<ConnectedApp[]>(QUERY_KEY, (current) =>
        withoutApp(current ?? [], app.clientId),
      );
      setMessage(fill(t.connectedApps.disconnected, { name }));
    } catch (caught) {
      setMessage(
        friendlyError(caught, t.connectedApps.couldNotDisconnect, 'connectedApps.disconnect'),
      );
    } finally {
      setBusyId(null);
    }
  }

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
          <Text variant="heading">{t.connectedApps.title}</Text>
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
        refreshControl={
          <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={theme.color.brand} />
        }
      >
        <Text variant="caption" tone="muted">
          {t.connectedApps.intro}
        </Text>

        {failed ? (
          <View style={{ gap: theme.spacing.lg }}>
            <EmptyState
              title={t.loadError}
              body={friendlyError(apps.error, t.loadErrorBody, 'connectedApps.load')}
            />
            {apps.isFetching ? (
              <ActivityIndicator color={theme.color.brand} />
            ) : (
              <Button label={t.retry} onPress={() => void apps.refetch()} />
            )}
          </View>
        ) : apps.isLoading ? (
          <View style={{ padding: theme.spacing.xl }}>
            <ActivityIndicator color={theme.color.brand} />
          </View>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Ionicons name="sparkles-outline" size={iconSize.xl} color={theme.color.brand} />}
            title={t.connectedApps.emptyTitle}
            body={t.connectedApps.emptyBody}
            action={
              <Button
                label={t.connectedApps.emptyLink}
                variant="ghost"
                size="sm"
                onPress={() => void Linking.openURL(CONNECT_GUIDE_URL)}
              />
            }
          />
        ) : (
          <Card style={{ paddingVertical: theme.spacing.xs }}>
            {rows.map((app, index) => (
              <View key={app.clientId}>
                {index > 0 ? <Divider /> : null}
                <AppRow
                  app={app}
                  locale={locale}
                  busy={busyId === app.clientId}
                  onDisconnect={() => void onDisconnect(app)}
                />
              </View>
            ))}
          </Card>
        )}

        {message ? (
          <Text variant="caption" tone="muted" align="center">
            {message}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function AppRow({
  app,
  locale,
  busy,
  onDisconnect,
}: {
  app: ConnectedApp;
  locale: string;
  busy: boolean;
  onDisconnect: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const when = new Date(app.grantedAt).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <Row style={{ paddingVertical: theme.spacing.sm, gap: theme.spacing.md }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: theme.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: theme.color.surfaceMuted,
        }}
      >
        {app.logoUri ? (
          <Image source={{ uri: app.logoUri }} style={{ width: 36, height: 36 }} />
        ) : (
          <Ionicons name="sparkles-outline" size={iconSize.lg} color={theme.color.textMuted} />
        )}
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="subheading" numberOfLines={1}>
          {app.name || t.connectedApps.unnamed}
        </Text>
        {app.scopes.length > 0 ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {app.scopes.join(' · ')}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted">
          {fill(t.connectedApps.connectedOn, { when })}
        </Text>
      </View>

      <Button
        label={t.connectedApps.disconnect}
        variant="danger"
        size="sm"
        disabled={busy}
        onPress={onDisconnect}
      />
    </Row>
  );
}
