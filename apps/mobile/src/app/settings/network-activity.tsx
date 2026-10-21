/**
 * Network activity: every connection Waves made from this phone in the last 7
 * days, so the app can be checked against what it says about itself.
 *
 * The list is kept on the phone and never uploaded (see `lib/netLog`). Each call
 * is shown by name ("Exchange rate"), never by method or address, with its time
 * and whether it worked. The background sync is not listed call by call: one row
 * at the top counts it. Reading the list makes no connection, so the screen does
 * not add to what it shows.
 */

import { useCallback, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, ScrollView, View } from 'react-native';

import {
  Card,
  Chip,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { ListRow } from '@/components/standard';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { DEFAULT_TILE_URL } from '@/lib/mapTiles';
import { router } from '@/lib/navigation';
import { clearNetLog, useNetLog, useSyncStats } from '@/lib/netLog';
import {
  callLabel,
  NET_FILTER_PURPOSES,
  urlParts,
  type NetLogEntry,
  type NetPurpose,
} from '@/lib/netLogCore';

type PurposeKey = keyof UiStrings['netlog']['purposes'];

const PURPOSE_KEY: Record<NetPurpose, PurposeKey> = {
  sync: 'sync',
  'sign-in': 'signIn',
  analytics: 'analytics',
  files: 'files',
  'exchange-rates': 'exchangeRates',
  'server-task': 'serverTask',
  purchases: 'purchases',
  'crash-reports': 'crashReports',
  'session-replay': 'sessionReplay',
  google: 'google',
  maps: 'maps',
  other: 'other',
};

const MONO = { fontFamily: 'monospace', writingDirection: 'ltr', textAlign: 'left' } as const;

type Item =
  { kind: 'day'; key: string; label: string } | { kind: 'call'; key: string; entry: NetLogEntry };

function dayKey(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Newest first, with a heading wherever the day changes. */
function withDays(entries: readonly NetLogEntry[], t: UiStrings, locale: string): Item[] {
  const now = Date.now();
  const today = dayKey(now);
  const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
  const items: Item[] = [];
  let last = '';
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const key = dayKey(entry.t);
    if (key !== last) {
      last = key;
      items.push({
        kind: 'day',
        key: `day-${key}`,
        label:
          key === today
            ? t.netlog.today
            : key === yesterday
              ? t.netlog.yesterday
              : new Date(entry.t).toLocaleDateString(locale, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                }),
      });
    }
    items.push({ kind: 'call', key: `${entry.t}-${i}`, entry });
  }
  return items;
}

/** The hosts a static entry is shown with, taken from this build's own config. */
function configuredHost(url: string | undefined, fallback: string): string {
  return (url ? urlParts(url.replace(/\{[a-z]\}/g, 'x'))?.host : undefined) ?? fallback;
}

interface Service {
  id: keyof UiStrings['netlog']['svc'];
  name: string;
  hosts: string[];
}

/** Only the services this app actually uses. Names are brands, so not translated. */
function services(): Service[] {
  return [
    {
      id: 'supabase',
      name: 'Supabase',
      hosts: [configuredHost(process.env.EXPO_PUBLIC_SUPABASE_URL, '*.supabase.co')],
    },
    { id: 'files', name: 'Cloudflare R2', hosts: ['*.r2.cloudflarestorage.com'] },
    { id: 'purchases', name: 'RevenueCat', hosts: ['api.revenuecat.com'] },
    { id: 'sentry', name: 'Sentry', hosts: ['*.ingest.sentry.io'] },
    {
      id: 'firebase',
      name: 'Google Firebase',
      hosts: [
        'identitytoolkit.googleapis.com',
        'securetoken.googleapis.com',
        'firebaseappcheck.googleapis.com',
      ],
    },
    { id: 'drive', name: 'Google Drive', hosts: ['www.googleapis.com', 'oauth2.googleapis.com'] },
    { id: 'clarity', name: 'Microsoft Clarity', hosts: ['*.clarity.ms'] },
    {
      id: 'maps',
      name: 'Map tiles',
      hosts: [configuredHost(DEFAULT_TILE_URL, 'tile.openstreetmap.org'), 'maps.googleapis.com'],
    },
    { id: 'appStore', name: 'Apple App Store', hosts: ['itunes.apple.com'] },
  ];
}

export default function NetworkActivityScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const log = useNetLog();
  const sync = useSyncStats();
  const [filter, setFilter] = useState<NetPurpose | 'all'>('all');

  // The store already keeps to the last 7 days and 1000 entries.
  const recent = log;
  const present = useMemo(
    () => NET_FILTER_PURPOSES.filter((purpose) => recent.some((entry) => entry.p === purpose)),
    [recent],
  );
  // A filter whose last entry was cleared falls back to everything.
  const active = filter === 'all' || present.includes(filter) ? filter : 'all';
  const items = useMemo(
    () => withDays(active === 'all' ? recent : recent.filter((e) => e.p === active), t, locale),
    [recent, active, t, locale],
  );
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  );

  const onClear = useCallback(async () => {
    const ok = await confirm({
      title: t.netlog.clearTitle,
      body: t.netlog.clearBody,
      confirmLabel: t.netlog.clearConfirm,
      tone: 'danger',
    });
    if (ok) await clearNetLog();
  }, [confirm, t.netlog]);

  const statusText = (entry: NetLogEntry): string =>
    entry.s === 'failed'
      ? t.netlog.statusFailed
      : entry.s === 'offline'
        ? t.netlog.statusOffline
        : entry.s >= 400
          ? t.netlog.statusFailed
          : t.netlog.statusOk;

  const syncCount = Object.values(sync.days).reduce((a, b) => a + b, 0);

  const header = (
    <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
      <Text variant="caption" tone="muted">
        {t.netlog.explainer}
      </Text>
      {syncCount > 0 ? (
        <ListRow
          leading={<Ionicons name="sync-outline" size={iconSize.lg} color={theme.color.text} />}
          title={plural(locale, syncCount, t.netlog.syncSummary)}
          subtitle={t.netlog.syncLast.replace('{time}', timeFormat.format(sync.last))}
          divider
        />
      ) : null}
      {present.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.sm }}
        >
          <Chip
            label={t.netlog.filterAll}
            selected={active === 'all'}
            repeatable
            onPress={() => setFilter('all')}
          />
          {present.map((purpose) => (
            <Chip
              key={purpose}
              label={t.netlog.purposes[PURPOSE_KEY[purpose]]}
              selected={active === purpose}
              repeatable
              onPress={() => setFilter(purpose)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );

  const footer = (
    <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.xl }}>
      <Text variant="subheading">{t.netlog.servicesTitle}</Text>
      {services().map((service) => (
        <Card key={service.id} style={{ gap: theme.spacing.xs }}>
          <Text variant="body" style={{ fontWeight: '700' }}>
            {service.name}
          </Text>
          <Text variant="caption" tone="muted" style={MONO}>
            {service.hosts.join('\n')}
          </Text>
          <Text variant="caption">
            <Text variant="caption" tone="muted">
              {t.netlog.usedFor}:{' '}
            </Text>
            {t.netlog.svc[service.id].purpose}
          </Text>
          <Text variant="caption">
            <Text variant="caption" tone="muted">
              {t.netlog.dataLabel}:{' '}
            </Text>
            {t.netlog.svc[service.id].data}
          </Text>
        </Card>
      ))}
      <Text variant="caption" tone="muted">
        {t.netlog.builtinNote}
      </Text>
      <Text variant="caption" tone="muted">
        {t.netlog.unseenNote}
      </Text>
    </View>
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
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.netlog.title}</Text>
        </View>
        <IconButton label={t.netlog.clear} onPress={() => void onClear()}>
          <Ionicons name="trash-outline" size={iconSize.lg} color={theme.color.text} />
        </IconButton>
      </Row>

      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: clearance,
        }}
        data={items}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          <Text variant="body" tone="muted" style={{ paddingVertical: theme.spacing.lg }}>
            {active === 'all' ? t.netlog.empty : t.netlog.emptyFiltered}
          </Text>
        }
        initialNumToRender={20}
        windowSize={7}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <Text
              variant="caption"
              tone="muted"
              style={{
                fontWeight: '700',
                paddingTop: theme.spacing.md,
                paddingBottom: theme.spacing.xs,
              }}
            >
              {item.label}
            </Text>
          ) : (
            <CallRow
              entry={item.entry}
              time={timeFormat.format(item.entry.t)}
              name={callLabel(item.entry, t.netlog.calls)}
              status={statusText(item.entry)}
              label={t.netlog.rowLabel}
            />
          )
        }
      />
    </Screen>
  );
}

/** One connection, in one line: its name, whether it worked, and when. */
function CallRow({
  entry,
  time,
  name,
  status,
  label,
}: {
  entry: NetLogEntry;
  time: string;
  name: string;
  status: string;
  label: string;
}) {
  const bad = entry.s === 'failed' || entry.s === 'offline' || entry.s >= 400;
  return (
    <View
      accessible
      accessibilityLabel={label
        .replace('{time}', time)
        .replace('{call}', name)
        .replace('{status}', status)}
    >
      <ListRow
        title={name}
        amount={time}
        divider
        trailing={
          <Text variant="caption" tone={bad ? 'negative' : 'muted'} style={{ minWidth: 48 }}>
            {status}
          </Text>
        }
      />
    </View>
  );
}
