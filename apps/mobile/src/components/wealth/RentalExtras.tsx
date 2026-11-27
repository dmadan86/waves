/** Documents (kept on this phone only) and extra details for one rental property. */

import { useCallback, useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { randomUUID } from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import { Image } from 'expo-image';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';

import type { PersonalProperty, PersonalTenancy } from '@waves/core';
import { Button, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import { OverflowMenu } from '@/components/OverflowMenu';
import { SectionHeader, StandardCard } from '@/components/standard';
import { RenameSheet, TextAnswer } from '@/components/wealth/parts';
import { localIsoDate } from '@/data/personal';
import { useWealthWrites } from '@/data/personalWealth';
import { useStrings } from '@/i18n';
import { PressableScale } from '@/lib/anim';
import { useDialog } from '@/lib/dialog';
import { dateFrom, showDate } from '@/lib/expenseDay';
import { pickReceiptImage, pickReceiptPhoto } from '@/lib/image';
import { scanDocument, scannerAvailable } from '@/lib/scanner';
import {
  attachDoc,
  deleteLocalDoc,
  localDocUri,
  openLocalDoc,
  readIndex,
  renameLocalSlot,
} from '@/lib/propertyDocs';
import {
  docMime,
  docsOf,
  formatSize,
  newSlotId,
  slotCount,
  slotsOf,
  type DocSlot,
  type LocalDoc,
} from '@/lib/propertyDocsPure';
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
  const theme = useTheme();
  const { t } = useStrings();
  const empty = value === t.wealth.notAdded;
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

type Target = { id: string; label?: string; replace?: readonly LocalDoc[] };
type Src = { uri: string; name: string; mime: string; size: number };

const SLOT_KEY = {
  agreement: 'docSlotAgreement',
  tenant_id: 'docSlotTenantId',
  move_in: 'docSlotMoveIn',
  police: 'docSlotPolice',
} as const;
const isImage = (d: LocalDoc): boolean => d.mime.startsWith('image/');
const GAP = 8;

/** Labelled slots for a rental's papers. Files never leave the phone and are never read. */
export function DocumentsCard({
  propertyId,
  region,
  groupId,
}: {
  propertyId: string;
  region: string;
  groupId?: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const w = t.wealth;
  const { choose, confirm, notify } = useDialog();
  const [docs, setDocs] = useState<readonly LocalDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(0);
  const [menu, setMenu] = useState<DocSlot | null>(null);
  const [renaming, setRenaming] = useState<DocSlot | null>(null);
  const [naming, setNaming] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

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

  const slots = slotsOf(docs, region);
  const { filled, total } = slotCount(slots);
  const nameOf = (s: DocSlot): string =>
    s.builtin ? w[SLOT_KEY[s.id as keyof typeof SLOT_KEY]] : (s.label ?? w.docSlotOther);
  const dateOf = (ms: number): string =>
    new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const kindOf = (s: DocSlot): string => {
    const n = s.docs.length;
    if (n === 1) return isImage(s.docs[0]!) ? w.docPhotoOne : w.docPdf;
    return (s.docs.every(isImage) ? w.docPhotos : w.docFiles).replace('{n}', String(n));
  };
  const addedOf = (s: DocSlot): string => {
    const ms = Math.max(0, ...s.docs.map((d) => d.added ?? 0));
    return ms ? dateOf(ms) : '';
  };

  const fail = (body: string) => notify({ title: w.documents, body, tone: 'danger' });

  const add = async (target: Target): Promise<void> => {
    if (busy) return;
    const label = target.label ?? w.docSlotOther;
    const way = await choose({
      title: w.attachDoc,
      options: [
        ...(scannerAvailable()
          ? [{ id: 'scan', label: w.docScan, icon: 'scan-outline' as const }]
          : []),
        { id: 'camera', label: t.personalReceipt.camera, icon: 'camera-outline' },
        { id: 'library', label: t.personalReceipt.library, icon: 'images-outline' },
        { id: 'file', label: w.attachFile, icon: 'document-text-outline' },
      ],
    });
    if (!way) return;
    setBusy(true);
    try {
      const stamp = localIsoDate(new Date());
      const photo = (uri: string, n = 1): Src => ({
        uri,
        name: `${label} ${stamp}${n > 1 ? ` ${n}` : ''}.jpg`,
        mime: 'image/jpeg',
        size: new FileSystem.File(uri).size,
      });
      let srcs: Src[] = [];
      if (way === 'file') {
        const picked = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/*'],
          copyToCacheDirectory: true,
        });
        const a = picked.canceled ? null : picked.assets[0];
        if (!a) return;
        const mime = docMime(a.name, a.mimeType);
        if (!mime) return void (await fail(w.docBadType));
        srcs = [
          { uri: a.uri, name: a.name, mime, size: a.size ?? new FileSystem.File(a.uri).size },
        ];
      } else if (way === 'scan') {
        const r = await scanDocument(24);
        if (r.kind === 'cancelled') return;
        if (r.kind === 'unavailable') return void (await fail(w.docOpenFailed));
        srcs = r.uris.map((u, i) => photo(u, i + 1));
      } else {
        const p = way === 'camera' ? await pickReceiptPhoto() : await pickReceiptImage();
        if (!p) return;
        srcs = [photo(p.uri)];
      }
      for (const src of srcs) await attachDoc(propertyId, src, target);
      // Replace only once the new file is safely in.
      for (const old of target.replace ?? []) await deleteLocalDoc(propertyId, old.id);
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

  const tap = (s: DocSlot): void => {
    if (s.docs.length === 0) void add({ id: s.id, label: s.label });
    else if (s.docs.length === 1) void open(s.docs[0]!);
    else setViewing(s.id);
  };

  const removeDocs = async (list: readonly LocalDoc[], name: string): Promise<void> => {
    const ok = await confirm({
      title: t.common.delete,
      body: w.docRemoveBody.replace('{n}', String(list.length)).replace('{name}', name),
      confirmLabel: t.common.delete,
      tone: 'danger',
    });
    if (!ok) return;
    for (const d of list) await deleteLocalDoc(propertyId, d.id);
    await reload();
  };

  const tileW = width > 0 ? (width - GAP) / 2 : undefined;
  const tileBase = {
    width: tileW,
    minHeight: 112,
    borderRadius: theme.radius.lg,
    overflow: 'hidden' as const,
  };
  const viewingSlot = slots.find((s) => s.id === viewing) ?? null;

  const emptyTile = (key: string, name: string, label: string, onPress: () => void) => (
    <PressableScale
      key={key}
      pressedScale={0.98}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={{
        ...tileBase,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
        padding: theme.spacing.sm,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: theme.color.border,
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Ionicons name="add" size={iconSize.lg} color={theme.color.brand} />
      <Text variant="caption" numberOfLines={2} style={{ fontWeight: '600', textAlign: 'center' }}>
        {name}
      </Text>
    </PressableScale>
  );

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <SectionHeader
        title={w.documents}
        trailing={
          <Text variant="caption" tone="muted">
            {w.docOf.replace('{a}', String(filled)).replace('{b}', String(total))}
          </Text>
        }
      />
      <StandardCard style={{ gap: theme.spacing.md }}>
        <View
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}
        >
          {slots.map((s) => {
            const name = nameOf(s);
            if (s.docs.length === 0)
              return emptyTile(s.id, name, w.docAddTo.replace('{name}', name), () => tap(s));
            const first = s.docs[0]!;
            const when = addedOf(s);
            return (
              <PressableScale
                key={s.id}
                pressedScale={0.98}
                accessibilityRole="button"
                accessibilityLabel={`${name}, ${kindOf(s)}${when ? `, ${w.docAdded.replace('{date}', when)}` : ''}`}
                onPress={() => tap(s)}
                onLongPress={() => setMenu(s)}
                style={{
                  ...tileBase,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  backgroundColor: theme.color.surface,
                }}
              >
                <View
                  style={{
                    height: 64,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.color.brandSoft,
                  }}
                >
                  {isImage(first) ? (
                    <Image
                      source={{ uri: localDocUri(propertyId, first) }}
                      style={{ width: '100%', height: '100%' }}
                      contentFit="cover"
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <Ionicons
                      name="document-text-outline"
                      size={iconSize.lg}
                      color={theme.color.brand}
                    />
                  )}
                </View>
                <View style={{ padding: theme.spacing.sm }}>
                  <Text variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
                    {name}
                  </Text>
                  <Text variant="micro" tone="muted" numberOfLines={1}>
                    {[kindOf(s), when].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.personalHome.toolMore}
                  hitSlop={8}
                  onPress={() => setMenu(s)}
                  style={{
                    position: 'absolute',
                    top: 4,
                    end: 4,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.color.surface,
                  }}
                >
                  <Ionicons
                    name="ellipsis-vertical"
                    size={iconSize.sm}
                    color={theme.color.textMuted}
                  />
                </Pressable>
              </PressableScale>
            );
          })}
          {emptyTile(
            'other-add',
            w.docSlotOther,
            w.docAddTo.replace('{name}', w.docSlotOther),
            () => setNaming(true),
          )}
        </View>
        <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          <Ionicons name="lock-closed-outline" size={iconSize.sm} color={theme.color.textMuted} />
          <Text variant="micro" tone="muted" style={{ flex: 1 }}>
            {w.docsLocalNote}
          </Text>
        </Row>
      </StandardCard>
      <OverflowMenu
        visible={menu !== null}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                ...(menu.builtin
                  ? []
                  : [
                      {
                        icon: 'create-outline' as const,
                        label: w.renameDoc,
                        onPress: () => setRenaming(menu),
                      },
                    ]),
                // Files never leave this phone on their own; in a shared space the person
                // can hand one to their partner through the OS share sheet.
                ...(groupId && menu.docs.length > 0
                  ? [
                      {
                        icon: 'share-outline' as const,
                        label: w.sendToPartner,
                        onPress: () => void open(menu.docs[0]!),
                      },
                    ]
                  : []),
                {
                  icon: 'swap-horizontal-outline' as const,
                  label: w.docReplace,
                  onPress: () => void add({ id: menu.id, label: menu.label, replace: menu.docs }),
                },
                {
                  icon: 'trash-outline' as const,
                  label: t.common.delete,
                  tone: 'danger' as const,
                  onPress: () => void removeDocs(menu.docs, nameOf(menu)),
                },
              ]
            : []
        }
      />
      {renaming ? (
        <RenameSheet
          visible
          title={w.renameDoc}
          placeholder={w.docNameHint}
          initial={renaming.label ?? ''}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            void renameLocalSlot(propertyId, renaming.id, name).then(reload);
            setRenaming(null);
          }}
        />
      ) : null}
      {naming ? (
        <RenameSheet
          visible
          title={w.docNameTitle}
          placeholder={w.docNameHint}
          initial=""
          onClose={() => setNaming(false)}
          onSave={(label) => {
            setNaming(false);
            void add({ id: newSlotId(randomUUID()), label: label.trim() });
          }}
        />
      ) : null}
      {viewingSlot ? (
        <Sheet
          visible
          onClose={() => setViewing(null)}
          title={nameOf(viewingSlot)}
          closeLabel={t.common.close}
        >
          <View style={{ gap: theme.spacing.md }}>
            <ScrollView
              style={{ maxHeight: 320 }}
              contentContainerStyle={{ gap: theme.spacing.sm }}
            >
              {viewingSlot.docs.map((d) => (
                <Row key={d.id} style={{ alignItems: 'center', gap: theme.spacing.md }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${d.name} ${formatSize(d.size)}`}
                    onPress={() => void open(d)}
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: theme.radius.sm,
                        overflow: 'hidden',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      {isImage(d) ? (
                        <Image
                          source={{ uri: localDocUri(propertyId, d) }}
                          style={{ width: 44, height: 44 }}
                          contentFit="cover"
                          accessibilityIgnoresInvertColors
                        />
                      ) : (
                        <Ionicons
                          name="document-text-outline"
                          size={iconSize.md}
                          color={theme.color.brand}
                        />
                      )}
                    </View>
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
                    accessibilityLabel={`${t.common.delete} ${d.name}`}
                    hitSlop={10}
                    onPress={() => void removeDocs([d], nameOf(viewingSlot))}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={iconSize.md}
                      color={theme.color.textMuted}
                    />
                  </Pressable>
                </Row>
              ))}
            </ScrollView>
            <Button
              fullWidth
              variant="secondary"
              label={w.docAddMore}
              disabled={busy}
              onPress={() => {
                const target = { id: viewingSlot.id, label: viewingSlot.label };
                setViewing(null);
                void add(target);
              }}
            />
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}
