/** Documents (kept on this phone only) and extra details for one rental property. */

import { useCallback, useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Linking, Platform, Pressable, View } from 'react-native';

import type { PersonalProperty, PersonalTenancy } from '@waves/core';
import { Button, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import { OverflowMenu } from '@/components/OverflowMenu';
import { SectionHeader, StandardCard } from '@/components/standard';
import { RenameSheet, TextAnswer } from '@/components/wealth/parts';
import { localIsoDate } from '@/data/personal';
import { useWealthWrites } from '@/data/personalWealth';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { dateFrom, showDate } from '@/lib/expenseDay';
import { captureReceipt, pickReceiptImage } from '@/lib/image';
import {
  attachDoc,
  deleteLocalDoc,
  openLocalDoc,
  readIndex,
  renameLocalDoc,
} from '@/lib/propertyDocs';
import { docMime, docsOf, formatSize, type LocalDoc } from '@/lib/propertyDocsPure';
import type { IconName } from '@/lib/wizardIcons';

/** Digits (and a leading +) only, so a pasted "98765 43210" still dials. */
export const dialable = (phone: string): string => phone.replace(/(?!^\+)[^\d]/g, '');

function Line({
  icon,
  label,
  value,
  onPress,
  trailing,
  last,
}: {
  icon: IconName;
  label: string;
  value: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  last?: boolean;
}) {
  const { t } = useStrings();
  const empty = value === t.wealth.notAdded;
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label} ${value}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingBottom: last ? 0 : theme.spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.color.border,
      }}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text
        variant="body"
        tone={empty ? 'muted' : undefined}
        numberOfLines={2}
        style={{ flex: 1, fontWeight: empty ? '400' : '600', textAlign: 'right' }}
      >
        {value}
      </Text>
      {trailing}
    </Pressable>
  );
}

function TextSheet({
  title,
  initial,
  keyboardType,
  onSave,
  onClose,
}: {
  title: string;
  initial: string;
  keyboardType?: 'default' | 'phone-pad';
  onSave: (v: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [v, setV] = useState(initial);
  return (
    <Sheet visible onClose={onClose} title={title} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <TextAnswer
          value={v}
          onChange={setV}
          placeholder={title}
          label={title}
          keyboardType={keyboardType}
        />
        <Button label={t.common.save} onPress={() => onSave(v.trim())} />
      </View>
    </Sheet>
  );
}

type Field = 'phone' | 'address' | 'note';

export function DetailsCard({
  prop,
  tenancy,
  groupId,
}: {
  prop: PersonalProperty;
  tenancy: PersonalTenancy | null;
  groupId?: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const w = t.wealth;
  const writes = useWealthWrites(groupId);
  const [field, setField] = useState<Field | null>(null);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const none = w.notAdded;
  const phone = tenancy?.tenantPhone ?? null;
  const dial = phone ? dialable(phone) : '';

  const save = (v: string): void => {
    if (field === 'phone' && tenancy)
      void writes.saveTenancy({ ...tenancy, tenantPhone: v || null });
    if (field === 'address') void writes.saveProperty({ ...prop, address: v || null });
    if (field === 'note') void writes.saveProperty({ ...prop, note: v || null });
    setField(null);
  };
  const initial =
    field === 'phone'
      ? (phone ?? '')
      : field === 'address'
        ? (prop.address ?? '')
        : (prop.note ?? '');
  const open = (url: string): void => void Linking.openURL(url).catch(() => {});

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <SectionHeader title={w.detailsTitle} />
      <StandardCard style={{ gap: theme.spacing.md }}>
        {tenancy ? (
          <>
            <Line
              icon="call-outline"
              label={w.tenantPhone.replace(/\s*\(.*\)/, '')}
              value={phone ?? none}
              onPress={() => setField('phone')}
            />
            {dial ? (
              <Row style={{ gap: theme.spacing.sm }}>
                {(
                  [
                    ['call-outline', w.callTenant, `tel:${dial}`],
                    ['logo-whatsapp', w.whatsappTenant, `https://wa.me/${dial.replace('+', '')}`],
                  ] as const
                ).map(([icon, label, url]) => (
                  <Pressable
                    key={label}
                    accessibilityRole="button"
                    accessibilityLabel={`${label} ${phone}`}
                    onPress={() => open(url)}
                    style={{
                      flex: 1,
                      minHeight: 44,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: theme.spacing.sm,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.color.brandSoft,
                    }}
                  >
                    <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
                    <Text variant="body" style={{ fontWeight: '700', color: theme.color.brand }}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </Row>
            ) : null}
          </>
        ) : null}
        <Line
          icon="location-outline"
          label={w.addressLabel}
          value={prop.address ?? none}
          onPress={() => setField('address')}
        />
        {tenancy ? (
          <>
            <Line
              icon="calendar-outline"
              label={w.agreementStart}
              value={tenancy.startDate ? showDate(tenancy.startDate, locale) : none}
              onPress={() => setPicking('start')}
            />
            <Line
              icon="calendar-number-outline"
              label={w.agreementEnd}
              value={tenancy.endDate ? showDate(tenancy.endDate, locale) : w.openEnded}
              onPress={() => setPicking('end')}
              trailing={
                tenancy.endDate ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={w.openEnded}
                    hitSlop={10}
                    onPress={() => void writes.saveTenancy({ ...tenancy, endDate: null })}
                  >
                    <Ionicons
                      name="close-circle-outline"
                      size={iconSize.md}
                      color={theme.color.textMuted}
                    />
                  </Pressable>
                ) : undefined
              }
            />
          </>
        ) : null}
        <Line
          icon="reader-outline"
          label={w.notesLabel}
          value={prop.note ?? none}
          onPress={() => setField('note')}
          last
        />
      </StandardCard>
      {picking && tenancy ? (
        <DateTimePicker
          value={dateFrom(
            (picking === 'start' ? tenancy.startDate : tenancy.endDate) || localIsoDate(new Date()),
          )}
          mode="date"
          onChange={(event, picked) => {
            if (Platform.OS !== 'ios') setPicking(null);
            if (event.type !== 'set' || !picked) return;
            const iso = localIsoDate(picked);
            void writes.saveTenancy(
              picking === 'start' ? { ...tenancy, startDate: iso } : { ...tenancy, endDate: iso },
            );
          }}
        />
      ) : null}
      {field ? (
        <TextSheet
          title={
            field === 'phone' ? w.tenantPhone : field === 'address' ? w.addressLabel : w.notesLabel
          }
          initial={initial}
          keyboardType={field === 'phone' ? 'phone-pad' : 'default'}
          onSave={save}
          onClose={() => setField(null)}
        />
      ) : null}
    </View>
  );
}

const iconFor = (mime: string): IconName =>
  mime === 'application/pdf' ? 'document-text-outline' : 'image-outline';

export function DocumentsCard({ propertyId, groupId }: { propertyId: string; groupId?: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const w = t.wealth;
  const { choose, confirm, notify } = useDialog();
  const [docs, setDocs] = useState<readonly LocalDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [menuDoc, setMenuDoc] = useState<LocalDoc | null>(null);
  const [renaming, setRenaming] = useState<LocalDoc | null>(null);

  const reload = useCallback(
    async () => setDocs(docsOf(await readIndex(), propertyId)),
    [propertyId],
  );
  useEffect(() => {
    let live = true;
    void readIndex().then((i) => live && setDocs(docsOf(i, propertyId)));
    return () => {
      live = false;
    };
  }, [propertyId]);

  const fail = (body: string) => notify({ title: w.documents, body, tone: 'danger' });

  const attach = async (): Promise<void> => {
    if (busy) return;
    const way = await choose({
      title: w.attachDoc,
      options: [
        { id: 'camera', label: w.attachPhoto, icon: 'camera-outline' },
        {
          id: 'library',
          label: `${w.attachPhoto} · ${t.personalReceipt.library}`,
          icon: 'images-outline',
        },
        { id: 'file', label: w.attachFile, icon: 'document-text-outline' },
      ],
    });
    if (!way) return;
    setBusy(true);
    try {
      let src: { uri: string; name: string; mime: string; size: number } | null = null;
      if (way === 'file') {
        const picked = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/*'],
          copyToCacheDirectory: true,
        });
        const a = picked.canceled ? null : picked.assets[0];
        if (!a) return;
        const mime = docMime(a.name, a.mimeType);
        if (!mime) return void (await fail(w.docBadType));
        src = { uri: a.uri, name: a.name, mime, size: a.size ?? new FileSystem.File(a.uri).size };
      } else {
        const p = way === 'camera' ? await captureReceipt() : await pickReceiptImage();
        if (!p) return;
        src = {
          uri: p.uri,
          name: `${w.attachPhoto} ${localIsoDate(new Date())}.jpg`,
          mime: 'image/jpeg',
          size: new FileSystem.File(p.uri).size,
        };
      }
      await attachDoc(propertyId, src);
      await reload();
    } catch {
      await fail(w.docOpenFailed);
    } finally {
      setBusy(false);
    }
  };

  const open = async (d: LocalDoc): Promise<void> => {
    try {
      if (!(await openLocalDoc(propertyId, d))) await fail(w.docOpenFailed);
    } catch {
      await fail(w.docOpenFailed);
    }
  };

  const remove = async (d: LocalDoc): Promise<void> => {
    const ok = await confirm({
      title: t.common.delete,
      body: d.name,
      confirmLabel: t.common.delete,
      tone: 'danger',
    });
    if (!ok) return;
    await deleteLocalDoc(propertyId, d.id);
    await reload();
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <SectionHeader title={w.documents} />
      <StandardCard style={{ gap: theme.spacing.md }}>
        {docs.length === 0 ? (
          <Text variant="caption" tone="muted">
            {w.docsEmpty}
          </Text>
        ) : (
          docs.map((d) => (
            <Row key={d.id} style={{ alignItems: 'center', gap: theme.spacing.md }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${d.name} ${formatSize(d.size)}`}
                onPress={() => void open(d)}
                onLongPress={() => setMenuDoc(d)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                }}
              >
                <Ionicons name={iconFor(d.mime)} size={iconSize.md} color={theme.color.brand} />
                <View style={{ flex: 1 }}>
                  <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                    {d.name}
                  </Text>
                  <Text variant="micro" tone="muted">
                    {formatSize(d.size)}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.personalHome.toolMore}
                hitSlop={10}
                onPress={() => setMenuDoc(d)}
              >
                <Ionicons
                  name="ellipsis-vertical"
                  size={iconSize.md}
                  color={theme.color.textMuted}
                />
              </Pressable>
            </Row>
          ))
        )}
        <Button
          label={w.attachDoc}
          variant="secondary"
          disabled={busy}
          icon={<Ionicons name="attach-outline" size={iconSize.md} color={theme.color.brand} />}
          onPress={() => void attach()}
        />
        <Text variant="micro" tone="muted">
          {w.docsLocalNote}
        </Text>
      </StandardCard>
      <OverflowMenu
        visible={menuDoc !== null}
        onClose={() => setMenuDoc(null)}
        items={
          menuDoc
            ? [
                {
                  icon: 'create-outline',
                  label: w.renameDoc,
                  onPress: () => setRenaming(menuDoc),
                },
                // Documents never leave this phone on their own; in a shared space the
                // person can hand one to their partner through the OS share sheet.
                ...(groupId
                  ? [
                      {
                        icon: 'share-outline' as const,
                        label: w.sendToPartner,
                        onPress: () => void open(menuDoc),
                      },
                    ]
                  : []),
                {
                  icon: 'trash-outline',
                  label: t.common.delete,
                  tone: 'danger',
                  onPress: () => void remove(menuDoc),
                },
              ]
            : []
        }
      />
      {renaming ? (
        <RenameSheet
          visible
          title={w.renameDoc}
          placeholder={w.renameDoc}
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            void renameLocalDoc(propertyId, renaming.id, name).then(reload);
            setRenaming(null);
          }}
        />
      ) : null}
    </View>
  );
}
