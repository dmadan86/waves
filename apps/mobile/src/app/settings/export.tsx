/**
 * Export your data — every expense, settlement and activity row, as a file to
 * keep, free, whoever you are.
 *
 * A promise card leads ("Your data, always yours"), then two choices as tiles:
 * the format (JSON is the lossless record; CSV the spreadsheet view; PDF the
 * printable one) and the scope (everything, or one group picked from a sheet).
 * "What's included?" says what the file holds, then Export. The import path
 * sits under an OR, since the two are the same door in opposite directions.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';

import {
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

import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { GroupMark } from '@/components/GroupMark';
import { exportData } from '@/data/api';
import { useGroupLabeller, useGroups } from '@/data/hooks';
import { friendlyError } from '@/lib/errors';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

enum Format {
  Json = 'json',
  Csv = 'csv',
  Pdf = 'pdf',
}

const UTI: Record<Format, string> = {
  [Format.Json]: 'public.json',
  [Format.Csv]: 'public.comma-separated-values-text',
  [Format.Pdf]: 'com.adobe.pdf',
};

/** Each format's tile: its glyph, the colour the glyph wears, and its subtitle. */
const FORMAT_TILE: Record<
  Format,
  { icon: keyof typeof Ionicons.glyphMap; color: string; sub: 'jsonSub' | 'csvSub' | 'pdfSub' }
> = {
  [Format.Json]: { icon: 'code-slash', color: '#6845E8', sub: 'jsonSub' },
  [Format.Csv]: { icon: 'grid', color: '#1E9E5A', sub: 'csvSub' },
  [Format.Pdf]: { icon: 'document-text', color: '#E5484D', sub: 'pdfSub' },
};

export default function ExportScreen() {
  const labelOf = useGroupLabeller();
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const groups = useGroups();
  const { t } = useStrings();

  const [format, setFormat] = useState<Format>(Format.Json);
  // 'all', or a group id. `pickingGroup` is the sheet the one-group tile opens.
  const [scope, setScope] = useState<string>('all');
  const [pickingGroup, setPickingGroup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const list = groups.data ?? [];
  const chosen = scope === 'all' ? null : list.find((group) => group.id === scope);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await exportData({
        format,
        groupId: scope === 'all' ? undefined : scope,
      });

      const file = new FileSystem.File(FileSystem.Paths.cache, result.filename);
      if (file.exists) file.delete();
      file.create();

      let sizeBytes: number;
      if (result.encoding === 'base64') {
        const bytes = new Uint8Array(decode(result.content));
        file.write(bytes);
        sizeBytes = bytes.byteLength;
      } else {
        file.write(result.content);
        sizeBytes = result.content.length;
      }

      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: result.contentType,
            dialogTitle: t.exportData.shareTitle,
            UTI: UTI[format],
          });
        }
      } finally {
        // The share sheet has taken its copy; nothing to keep in the cache.
        try {
          if (file.exists) file.delete();
        } catch {
          // A stale temp file is harmless.
        }
      }
      setDone(`${result.filename} · ${Math.ceil(sizeBytes / 1024)} KB`);
    } catch (caught) {
      setError(friendlyError(caught, t.exportData.exportFailed, 'export.run'));
    } finally {
      setBusy(false);
    }
  };

  const soft = theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F1EEFC';

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
          <Text variant="heading">{t.exportData.title}</Text>
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
        showsVerticalScrollIndicator={false}
      >
        {/* The promise, on a soft wash with a folder of files drawn beside it. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            padding: theme.spacing.lg,
            borderRadius: theme.radius.xl,
            backgroundColor: soft,
          }}
        >
          <View style={{ flex: 1, gap: theme.spacing.sm }}>
            <Text
              style={{ fontSize: 24, lineHeight: 29, fontWeight: '800', color: theme.color.text }}
            >
              {t.exportForm.heroTitle}
            </Text>
            <Text variant="caption" tone="muted" style={{ lineHeight: 19 }}>
              {t.exportForm.heroBody}
            </Text>
            <Row
              style={{
                alignSelf: 'flex-start',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 5,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Ionicons name="checkmark-circle" size={iconSize.sm} color={theme.color.brand} />
              <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                {t.exportForm.freeBadge}
              </Text>
            </Row>
          </View>
          <FolderArt />
        </View>

        <Card style={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
          <View style={{ gap: 2 }}>
            <Text variant="subheading">{t.exportForm.chooseFormat}</Text>
            <Text variant="caption" tone="muted">
              {t.exportForm.chooseFormatSub}
            </Text>
          </View>
          <Row style={{ gap: theme.spacing.sm }}>
            {(Object.keys(FORMAT_TILE) as Format[]).map((entry) => {
              const tile = FORMAT_TILE[entry];
              const selected = entry === format;
              return (
                <Pressable
                  key={entry}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t.exportData[entry]}
                  onPress={() => setFormat(entry)}
                  style={({ pressed }) => ({
                    flex: 1,
                    alignItems: 'center',
                    gap: 2,
                    paddingVertical: theme.spacing.md,
                    borderRadius: 14,
                    borderWidth: selected ? 1.5 : 1,
                    borderColor: selected ? theme.color.brand : theme.color.border,
                    backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      marginBottom: 4,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: tile.color,
                    }}
                  >
                    <Ionicons name={tile.icon} size={iconSize.md} color="#FFFFFF" />
                  </View>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '700',
                      color: selected ? theme.color.brand : theme.color.text,
                    }}
                  >
                    {entry.toUpperCase()}
                  </Text>
                  <Text variant="micro" tone={selected ? 'brand' : 'muted'}>
                    {t.exportForm[tile.sub]}
                  </Text>
                  {selected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={iconSize.md}
                      color={theme.color.brand}
                      style={{ position: 'absolute', top: 6, end: 6 }}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </Row>
        </Card>

        <Card style={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
          <View style={{ gap: 2 }}>
            <Text variant="subheading">{t.exportData.whatToExport}</Text>
            <Text variant="caption" tone="muted">
              {t.exportForm.whatSub}
            </Text>
          </View>
          <Row style={{ gap: theme.spacing.sm }}>
            <ScopeTile
              icon="people-outline"
              title={t.exportData.allMyGroups}
              subtitle={t.exportForm.everything}
              selected={scope === 'all'}
              onPress={() => setScope('all')}
            />
            <ScopeTile
              icon="folder-outline"
              title={chosen ? labelOf(chosen) : t.exportForm.oneGroup}
              subtitle={t.exportForm.oneGroupSub}
              selected={scope !== 'all'}
              disabled={list.length === 0}
              onPress={() => setPickingGroup(true)}
            />
          </Row>

          <Row
            style={{
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              borderRadius: theme.radius.lg,
              backgroundColor: soft,
            }}
          >
            <Ionicons name="document-text-outline" size={iconSize.lg} color={theme.color.brand} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body" tone="brand" style={{ fontWeight: '700' }}>
                {t.exportForm.includedTitle}
              </Text>
              <Text variant="caption" tone="muted" style={{ lineHeight: 19 }}>
                {t.exportForm.includedBody}
              </Text>
            </View>
          </Row>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? t.exportData.preparing : t.exportForm.exportAction}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => void run()}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.sm,
              minHeight: 54,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.brand,
              opacity: busy ? 0.6 : pressed ? 0.85 : 1,
            })}
          >
            {busy ? (
              <ActivityIndicator color={theme.color.onBrand} />
            ) : (
              <Ionicons name="download-outline" size={iconSize.lg} color={theme.color.onBrand} />
            )}
            <Text variant="subheading" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
              {busy ? t.exportData.preparing : t.exportForm.exportAction}
            </Text>
          </Pressable>

          {done ? (
            <View style={{ gap: 2 }}>
              <Text variant="body" tone="positive" align="center" style={{ fontWeight: '600' }}>
                {t.exportData.ready}
              </Text>
              <Text variant="caption" tone="muted" align="center">
                {done}
              </Text>
              {Platform.OS === 'web' ? (
                <Text variant="micro" tone="muted" align="center">
                  {t.exportData.webNote}
                </Text>
              ) : null}
            </View>
          ) : null}
          {error ? <Callout tone="negative">{error}</Callout> : null}

          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
            <Text variant="micro" tone="muted" style={{ fontWeight: '700', letterSpacing: 1 }}>
              {t.exportForm.or}
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
          </Row>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.exportData.importInstead}
            onPress={() => router.push('/settings/import')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              minHeight: 52,
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radius.pill,
              borderWidth: 1.5,
              borderColor: theme.color.brandSoft,
              backgroundColor: theme.color.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flex: 1 }} />
            <Ionicons name="cloud-upload-outline" size={iconSize.lg} color={theme.color.brand} />
            <Text variant="body" tone="brand" style={{ fontWeight: '700' }}>
              {t.exportData.importInstead}
            </Text>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.md}
                color={theme.color.brand}
              />
            </View>
          </Pressable>
        </Card>
      </ScrollView>

      {/* Which group, when only one is wanted. */}
      {pickingGroup ? (
        <SheetOverlay title={t.exportForm.pickGroup} onClose={() => setPickingGroup(false)}>
          <View style={{ gap: theme.spacing.xs }}>
            {list.map((group) => (
              <ChoiceRow
                key={group.id}
                leading={<GroupMark emoji={group.cover_emoji} size={22} />}
                label={labelOf(group)}
                selected={scope === group.id}
                onPress={() => {
                  setScope(group.id);
                  setPickingGroup(false);
                }}
              />
            ))}
          </View>
        </SheetOverlay>
      ) : null}
    </Screen>
  );
}

/** One scope as a tile: a glyph, the name over a line, lit and ticked when chosen. */
function ScopeTile({
  icon,
  title,
  subtitle,
  selected,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${title}. ${subtitle}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        borderRadius: 14,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? theme.color.brand : theme.color.border,
        backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={iconSize.lg}
        color={selected ? theme.color.brand : theme.color.text}
      />
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 14, fontWeight: '700', color: theme.color.text }}
        >
          {title}
        </Text>
        <Text variant="micro" tone={selected ? 'brand' : 'muted'} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {selected ? (
        <Ionicons
          name="checkmark-circle"
          size={iconSize.md}
          color={theme.color.brand}
          style={{ position: 'absolute', top: 6, end: 6 }}
        />
      ) : null}
    </Pressable>
  );
}

/**
 * The promise card's picture: a brand folder with three file tabs — JSON, CSV,
 * PDF — leaning out of it and a download disc at its corner, drawn from views.
 * Decoration only, so it is hidden from screen readers.
 */
function FolderArt() {
  const theme = useTheme();
  const tabs: { label: string; color: string; top: number }[] = [
    { label: 'JSON', color: '#4F6DF5', top: 0 },
    { label: 'CSV', color: '#1E9E5A', top: 22 },
    { label: 'PDF', color: '#E5484D', top: 44 },
  ];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: 112, height: 104 }}
    >
      <View
        style={{
          position: 'absolute',
          start: 0,
          bottom: 4,
          width: 96,
          height: 60,
          borderRadius: 12,
          backgroundColor: theme.color.brand,
          opacity: 0.85,
        }}
      />
      <View
        style={{
          position: 'absolute',
          start: 22,
          top: 0,
          width: 68,
          height: 72,
          borderRadius: 10,
          backgroundColor: theme.color.surface,
          transform: [{ rotate: '8deg' }],
          padding: 6,
          gap: 4,
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        }}
      >
        {tabs.map((tab) => (
          <View
            key={tab.label}
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 5,
              backgroundColor: tab.color,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: '800', color: '#FFFFFF' }}>{tab.label}</Text>
          </View>
        ))}
      </View>
      <View
        style={{
          position: 'absolute',
          end: 0,
          bottom: 0,
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: theme.color.surface,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.15,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        }}
      >
        <Ionicons name="arrow-down" size={iconSize.md} color={theme.color.brand} />
      </View>
    </View>
  );
}
