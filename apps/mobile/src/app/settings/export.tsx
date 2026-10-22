/**
 * Export your data — every expense, settlement and activity row, as a file to
 * keep, free, whoever you are.
 *
 * Two small cards: the format (JSON is the lossless record; CSV the
 * spreadsheet view; PDF the printable one) and the scope (everything, or one
 * group picked from a sheet), then one Export button. What the file holds sits
 * behind the ⓘ beside "Format". The import path is a plain row underneath.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';

import { Callout, iconSize, Row, Text, useTabBarClearance, useTheme } from '@waves/ui';

import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { GroupMark } from '@/components/GroupMark';
import { ListRow, PlainHeader, RowTile, SectionHeader, StandardCard } from '@/components/standard';
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

/** Each format's chip subtitle. */
const FORMAT_SUB: Record<Format, 'jsonSub' | 'csvSub' | 'pdfSub'> = {
  [Format.Json]: 'jsonSub',
  [Format.Csv]: 'csvSub',
  [Format.Pdf]: 'pdfSub',
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
  const [showIncluded, setShowIncluded] = useState(false);
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

  const radio = (on: boolean) => (
    <Ionicons
      name={on ? 'radio-button-on' : 'radio-button-off'}
      size={iconSize.lg}
      color={on ? theme.color.brand : theme.color.textFaint}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <PlainHeader title={t.exportData.title} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader
            title={t.exportData.format}
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.exportForm.includedTitle}
                hitSlop={10}
                onPress={() => setShowIncluded(true)}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={iconSize.lg}
                  color={theme.color.brand}
                />
              </Pressable>
            }
          />
          <StandardCard style={{ gap: theme.spacing.sm }}>
            <Row style={{ gap: theme.spacing.sm }}>
              {(Object.keys(FORMAT_SUB) as Format[]).map((entry) => {
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
                      paddingVertical: theme.spacing.sm,
                      borderRadius: theme.radius.lg,
                      borderWidth: selected ? 1.5 : 1,
                      borderColor: selected ? theme.color.brand : theme.color.border,
                      backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text
                      style={{
                        fontWeight: '700',
                        color: selected ? theme.color.brand : theme.color.text,
                      }}
                    >
                      {entry.toUpperCase()}
                    </Text>
                    <Text variant="micro" tone={selected ? 'brand' : 'muted'} numberOfLines={1}>
                      {t.exportForm[FORMAT_SUB[entry]]}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
          </StandardCard>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.exportData.whatToExport} />
          <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
            <ListRow
              divider
              leading={
                <RowTile tint={theme.color.brandSoft}>
                  <Ionicons name="people-outline" size={iconSize.lg} color={theme.color.brand} />
                </RowTile>
              }
              title={t.exportData.allMyGroups}
              subtitle={t.exportForm.everything}
              trailing={radio(scope === 'all')}
              onPress={() => setScope('all')}
            />
            <ListRow
              leading={
                <RowTile tint={theme.color.brandSoft}>
                  <Ionicons name="folder-outline" size={iconSize.lg} color={theme.color.brand} />
                </RowTile>
              }
              title={chosen ? labelOf(chosen) : t.exportForm.oneGroup}
              subtitle={t.exportForm.oneGroupSub}
              trailing={radio(scope !== 'all')}
              onPress={list.length === 0 ? undefined : () => setPickingGroup(true)}
            />
          </StandardCard>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
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
              minHeight: 52,
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
          <Text variant="micro" tone="muted" align="center">
            {t.exportForm.freeBadge}
          </Text>

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
        </View>

        <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
          <ListRow
            leading={
              <RowTile tint={theme.color.brandSoft}>
                <Ionicons
                  name="cloud-upload-outline"
                  size={iconSize.lg}
                  color={theme.color.brand}
                />
              </RowTile>
            }
            title={t.exportData.importInstead}
            onPress={() => router.push('/settings/import')}
          />
        </StandardCard>
      </ScrollView>

      {/* What the file holds. */}
      {showIncluded ? (
        <SheetOverlay title={t.exportForm.includedTitle} onClose={() => setShowIncluded(false)}>
          <Text variant="body" tone="muted">
            {t.exportForm.includedBody}
          </Text>
        </SheetOverlay>
      ) : null}

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
    </View>
  );
}
