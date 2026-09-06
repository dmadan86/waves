/**
 * The shelf: every pack we have published.
 *
 * The app's ten spend categories and fifteen income sources are deliberately
 * general — nothing shaped to one country's instruments or one person's trade.
 * A pack is how somebody gets the words they actually use without those words
 * being shipped to everybody: a landlord's, a freelancer's, a chit fund's.
 *
 * The catalogue is a network read, not a mirrored table. What we publish is not
 * the user's data, and holding a copy would make every visit an offline read of
 * a stale shelf. Offline it is empty and says so; nothing else suffers for it,
 * because the categories somebody has already added are ordinary tags in their
 * own catalog by then.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Pressable, TextInput, View } from 'react-native';

import {
  Button,
  Card,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useScreenClearance,
  useTheme,
} from '@waves/ui';

import { useInstalledPacks, usePacks, useRequestPack, type ShelfPack } from '@/data/packs';
import { plural, useStrings } from '@/i18n';

export default function PacksScreen() {
  const theme = useTheme();
  const clearance = useScreenClearance();
  const { t, locale } = useStrings();
  const packs = usePacks();
  const installed = useInstalledPacks();
  const [asking, setAsking] = useState(false);

  const installedIds = new Set(installed.map((row) => row.packId));

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
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
          <Text variant="heading">{t.packs.title}</Text>
        </View>
        <View style={{ width: iconSize.lg + theme.spacing.md }} />
      </Row>

      <FlashList
        data={packs.data ?? []}
        keyExtractor={(pack) => pack.id}
        extraData={[locale, theme.scheme, installedIds.size]}
        drawDistance={1500}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
        }}
        ListHeaderComponent={
          <Text
            variant="caption"
            tone="muted"
            align="center"
            style={{ paddingVertical: theme.spacing.md }}
          >
            {t.packs.subtitle}
          </Text>
        }
        ListEmptyComponent={
          <View style={{ paddingTop: theme.spacing.xxxl, gap: theme.spacing.lg }}>
            <EmptyState
              title={packs.isError ? t.loadError : t.packs.empty}
              body={packs.isError ? t.packs.offline : t.packs.emptyBody}
            />
            {packs.isError ? <Button label={t.retry} onPress={() => void packs.refetch()} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <PackRow
            pack={item}
            installed={installedIds.has(item.id)}
            onPress={() =>
              router.push({ pathname: '/settings/packs/[slug]', params: { slug: item.slug } })
            }
          />
        )}
        ListFooterComponent={
          // The other half of "we author them, others ask". Deliberately quiet
          // and at the bottom: it is an offer, not a form somebody must fill in
          // before the shelf is useful.
          <Pressable
            accessibilityRole="button"
            onPress={() => setAsking(true)}
            style={({ pressed }) => ({
              paddingVertical: theme.spacing.xl,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text variant="caption" tone="brand" align="center">
              {t.packs.askTitle}
            </Text>
          </Pressable>
        }
      />

      {asking ? <AskSheet onClose={() => setAsking(false)} /> : null}
    </Screen>
  );
}

function PackRow({
  pack,
  installed,
  onPress,
}: {
  pack: ShelfPack;
  installed: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pack.title}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Card style={{ marginBottom: theme.spacing.md, gap: theme.spacing.sm }}>
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Text variant="subheading" style={{ flex: 1 }} numberOfLines={1}>
            {pack.title}
          </Text>
          {installed ? (
            <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
              <Ionicons name="checkmark-circle" size={iconSize.md} color={theme.color.positive} />
              <Text variant="micro" tone="positive">
                {t.packs.installed}
              </Text>
            </Row>
          ) : null}
        </Row>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {pack.summary}
        </Text>
        {/* A few of the actual chips, so the shelf shows what is inside rather
            than only claiming a number. */}
        <Row style={{ gap: theme.spacing.xs, flexWrap: 'wrap' }}>
          {pack.entries.slice(0, 4).map((entry) => (
            <Row
              key={entry.key}
              style={{
                gap: theme.spacing.xs,
                alignItems: 'center',
                paddingVertical: theme.spacing.xs,
                paddingHorizontal: theme.spacing.sm,
                borderRadius: theme.radius.sm,
                backgroundColor: theme.tint[entry.tint].bg,
              }}
            >
              <Ionicons
                name={entry.icon as keyof typeof Ionicons.glyphMap}
                size={iconSize.sm}
                color={theme.tint[entry.tint].ink}
              />
              <Text variant="micro" style={{ color: theme.tint[entry.tint].ink }}>
                {entry.label}
              </Text>
            </Row>
          ))}
        </Row>
        <Text variant="micro" tone="faint">
          {plural(locale, pack.entries.length, t.packs.includes)}
        </Text>
      </Card>
    </Pressable>
  );
}

/** One sentence, one row, nothing anybody else ever sees. */
function AskSheet({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const { t } = useStrings();
  const request = useRequestPack();
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);

  const send = (): void => {
    if (body.trim().length === 0 || request.isPending) return;
    request.mutate(body, { onSuccess: () => setSent(true) });
  };

  return (
    <Sheet visible onClose={onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <Text variant="heading">{t.packs.askTitle}</Text>
        {sent ? (
          <>
            <Text variant="body" tone="muted">
              {t.packs.askSent}
            </Text>
            <Button label={t.common.close} size="lg" fullWidth onPress={onClose} />
          </>
        ) : (
          <>
            <Text variant="caption" tone="muted">
              {t.packs.askBody}
            </Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={t.packs.askPlaceholder}
              placeholderTextColor={theme.color.textFaint}
              multiline
              maxLength={500}
              style={{
                minHeight: 96,
                fontSize: 16,
                color: theme.color.text,
                textAlignVertical: 'top',
                padding: theme.spacing.lg,
                backgroundColor: theme.color.surfaceMuted,
                borderRadius: theme.radius.md,
              }}
            />
            <Button
              label={t.packs.askSend}
              size="lg"
              fullWidth
              onPress={send}
              disabled={body.trim().length === 0 || request.isPending}
            />
          </>
        )}
      </View>
    </Sheet>
  );
}
