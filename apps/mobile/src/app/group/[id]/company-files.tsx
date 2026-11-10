/**
 * Company Files: folders, uploaded files and links, each with a "who can see" setting.
 * Owners and managers add and edit (a manager only their own); everyone else only opens what they may see.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  companyFileType,
  filterCompanyFiles,
  normaliseLinkUrl,
  uploadMime,
  visibilityChoices,
  type CompanyFileFilter,
  type CompanyFileType,
  type CompanyFileVisibility,
} from '@waves/core';
import {
  Button,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { RowMenu } from '@/components/company/listParts';
import type { OverflowMenuItem } from '@/components/OverflowMenu';
import { ListRow, RowTile, SegmentedPills, StandardCard } from '@/components/standard';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import {
  MAX_COMPANY_FILE_BYTES,
  openCompanyFile,
  useCompanyFileActions,
  useCompanyFiles,
  type CompanyFile,
  type CompanyFolder,
} from '@/data/companyFiles';
import { fill, useStrings } from '@/i18n';
import { formatBytes } from '@/lib/bytes';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';
import { StorageCapError } from '@/lib/storage';

const YELLOW = '#F5B301';
const TYPE_LOOK: Record<CompanyFileType, { icon: keyof typeof Ionicons.glyphMap; ink: string }> = {
  documents: { icon: 'document-text', ink: '#E5484D' },
  sheets: { icon: 'grid', ink: '#1F9D55' },
  images: { icon: 'image', ink: '#2563EB' },
  links: { icon: 'link', ink: '#6D5BD0' },
  others: { icon: 'document', ink: '#6B7280' },
};

/** What the one edit sheet is doing: adding or editing a folder or link, naming an upload, or editing a file. */
type Edit =
  | { mode: 'folder'; folder?: CompanyFolder }
  | { mode: 'link'; file?: CompanyFile }
  | { mode: 'file'; file: CompanyFile }
  | { mode: 'upload'; uri: string; name: string; mime: string };

export default function CompanyFilesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const s = t.companyFiles;
  const { notify, confirm } = useDialog();
  const view = useCompanyEntries(groupId);
  const suspended = useCompanySuspended(groupId);
  const { folders, files } = useCompanyFiles(groupId);
  const actions = useCompanyFileActions(groupId);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<CompanyFileFilter>('all');
  const [query, setQuery] = useState('');
  const [grid, setGrid] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [busy, setBusy] = useState(false);

  const canAdd = (view.isOwner || view.isManager) && !suspended;
  const mine = (createdBy: string) => view.isOwner || (view.isManager && createdBy === view.me?.id);
  const canEdit = (createdBy: string) => !suspended && mine(createdBy);
  const folder = folders.find((f) => f.id === folderId) ?? null;
  const searching = query.trim() !== '' || filter !== 'all';

  // Inside a folder: its items. At the top: folders and loose items; a search or type pill looks through everything.
  const shownFiles = useMemo(() => {
    const pool = searching ? files : files.filter((f) => f.folderId === folderId);
    return filterCompanyFiles(pool, filter, query);
  }, [files, folderId, filter, query, searching]);
  const shownFolders = useMemo(
    () =>
      folderId !== null || filter !== 'all'
        ? []
        : folders.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase())),
    [folders, folderId, filter, query],
  );
  const itemCount = (fid: string) => files.filter((f) => f.folderId === fid).length;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const fail = (caught: unknown, fallback: string) =>
    notify({
      title:
        caught instanceof StorageCapError
          ? s.storageFull
          : caught instanceof Error && caught.message.includes('INVALID_DATA')
            ? s.linkUrlBad
            : fallback,
      tone: 'danger',
    });

  const pickFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      const asset = picked.canceled ? null : picked.assets[0];
      if (!asset) return;
      if (asset.size !== undefined && asset.size > MAX_COMPANY_FILE_BYTES) {
        await notify({ title: s.tooBig, tone: 'danger' });
        return;
      }
      const mime = uploadMime(asset.name, asset.mimeType);
      if (!mime) {
        await notify({ title: s.badType, tone: 'danger' });
        return;
      }
      setEdit({ mode: 'upload', uri: asset.uri, name: asset.name, mime });
    } catch {
      await notify({ title: s.uploadFailed, tone: 'danger' });
    }
  };

  const open = async (file: CompanyFile) => {
    if (file.kind === 'link') {
      // Only web addresses ever open, whatever the row says.
      if (file.url && /^https?:\/\//i.test(file.url))
        await Linking.openURL(file.url).catch(() => {});
      return;
    }
    setBusy(true);
    try {
      if (!(await openCompanyFile(file))) await notify({ title: s.openFailed, tone: 'danger' });
    } catch {
      await notify({ title: s.openFailed, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async (file: CompanyFile) => {
    const ok = await confirm({
      title: fill(s.deleteFileTitle, { name: file.name }),
      body: s.deleteFileBody,
      confirmLabel: t.common.delete,
      tone: 'danger',
    });
    if (ok) await actions.remove.mutateAsync(file.id).catch((e) => fail(e, s.saveFailed));
  };
  const removeFolder = async (f: CompanyFolder) => {
    const ok = await confirm({
      title: fill(s.deleteFolderTitle, { name: f.name }),
      body: s.deleteFolderBody,
      confirmLabel: t.common.delete,
      tone: 'danger',
    });
    if (!ok) return;
    await actions.deleteFolder.mutateAsync(f.id).catch((e) => fail(e, s.saveFailed));
    if (folderId === f.id) setFolderId(null);
  };

  const visLabel: Record<CompanyFileVisibility, string> = {
    everyone: s.visEveryone,
    managers: s.visManagers,
    owners: s.visOwners,
  };
  const iconFor = (file: CompanyFile) => TYPE_LOOK[companyFileType(file)];
  const meta = (file: CompanyFile) =>
    file.kind === 'link'
      ? `${file.url?.replace(/^https?:\/\//i, '').split('/')[0] ?? ''} · ${date(file.createdAt)}`
      : `${formatBytes(file.sizeBytes, locale)} · ${date(file.createdAt)}`;

  const fileMenu = (file: CompanyFile): OverflowMenuItem[] => [
    { icon: 'open-outline' as const, label: s.open, onPress: () => void open(file) },
    ...(canEdit(file.createdBy)
      ? [
          {
            icon: 'create-outline' as const,
            label: t.common.edit,
            onPress: () =>
              setEdit(file.kind === 'link' ? { mode: 'link', file } : { mode: 'file', file }),
          },
          {
            icon: 'trash-outline' as const,
            label: t.common.delete,
            onPress: () => void removeFile(file),
          },
        ]
      : []),
  ];
  const folderMenu = (f: CompanyFolder): OverflowMenuItem[] => [
    { icon: 'folder-open-outline' as const, label: s.open, onPress: () => setFolderId(f.id) },
    ...(canEdit(f.createdBy)
      ? [
          {
            icon: 'create-outline' as const,
            label: t.common.edit,
            onPress: () => setEdit({ mode: 'folder', folder: f }),
          },
          {
            icon: 'trash-outline' as const,
            label: t.common.delete,
            onPress: () => void removeFolder(f),
          },
        ]
      : []),
  ];

  const empty = folders.length === 0 && files.length === 0;
  const nothingHere = shownFiles.length === 0 && shownFolders.length === 0;

  // One row (list) or tile (grid) per item.
  const tile = (
    key: string,
    icon: keyof typeof Ionicons.glyphMap,
    ink: string,
    title: string,
    sub: string,
    onPress: () => void,
    menu: OverflowMenuItem[],
    last: boolean,
  ) =>
    grid ? (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={{
          width: '48%',
          gap: theme.spacing.xs,
          padding: theme.spacing.md,
          borderRadius: theme.radius.md,
          backgroundColor: theme.color.surface,
        }}
      >
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Ionicons name={icon} size={30} color={ink} />
          <RowMenu label={`${s.more}: ${title}`} items={menu} />
        </Row>
        <Text numberOfLines={1} style={{ fontWeight: '600' }}>
          {title}
        </Text>
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {sub}
        </Text>
      </Pressable>
    ) : (
      <ListRow
        key={key}
        divider={!last}
        title={title}
        subtitle={sub}
        leading={
          <RowTile tint={`${ink}22`}>
            <Ionicons name={icon} size={iconSize.md} color={ink} />
          </RowTile>
        }
        trailing={<RowMenu label={`${s.more}: ${title}`} items={menu} />}
        onPress={onPress}
      />
    );

  const rows = [
    ...shownFolders.map((f, i) =>
      tile(
        f.id,
        'folder',
        YELLOW,
        f.name,
        fill(s.folderItems, { n: itemCount(f.id) }),
        () => setFolderId(f.id),
        folderMenu(f),
        i === shownFolders.length - 1 && shownFiles.length === 0,
      ),
    ),
    ...shownFiles.map((f, i) => {
      const look = iconFor(f);
      return tile(
        f.id,
        look.icon,
        look.ink,
        f.name,
        meta(f),
        () => void open(f),
        fileMenu(f),
        i === shownFiles.length - 1,
      );
    }),
  ];

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xs }}>
        <IconButton
          label={t.common.back}
          onPress={() => (folder ? setFolderId(null) : router.back())}
        >
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }} numberOfLines={1}>
            {folder ? folder.name : s.title}
          </Text>
        </View>
        <View style={{ width: 44 }}>{busy ? <ActivityIndicator /> : null}</View>
      </Row>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          paddingTop: theme.spacing.xs,
          gap: theme.spacing.sm,
        }}
      >
        {canAdd ? (
          <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            <Button label={s.upload} variant="brand" size="sm" onPress={() => void pickFile()} />
            <Button
              label={s.addLink}
              variant="secondary"
              size="sm"
              onPress={() => setEdit({ mode: 'link' })}
            />
            {folderId === null ? (
              <Button
                label={s.newFolder}
                variant="secondary"
                size="sm"
                onPress={() => setEdit({ mode: 'folder' })}
              />
            ) : null}
          </Row>
        ) : null}
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              minHeight: 44,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.surface,
            }}
          >
            <Ionicons name="search" size={iconSize.md} color={theme.color.textMuted} />
            <TextInput
              accessibilityLabel={s.search}
              value={query}
              onChangeText={setQuery}
              placeholder={s.search}
              placeholderTextColor={theme.color.textMuted}
              style={{ flex: 1, color: theme.color.text, fontSize: 16 }}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={grid ? s.listView : s.gridView}
            onPress={() => setGrid(!grid)}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.surface,
            }}
          >
            <Ionicons
              name={grid ? 'list' : 'grid-outline'}
              size={iconSize.md}
              color={theme.color.text}
            />
          </Pressable>
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <SegmentedPills
            options={[
              { value: 'all' as const, label: s.all },
              { value: 'documents' as const, label: s.documents },
              { value: 'images' as const, label: s.images },
              { value: 'sheets' as const, label: s.sheets },
              { value: 'links' as const, label: s.links },
              { value: 'others' as const, label: s.others },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </ScrollView>
        {empty ? (
          <StandardCard style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Ionicons name="folder-open-outline" size={48} color={theme.color.brand} />
            <Text variant="title" style={{ fontSize: 18 }}>
              {s.empty}
            </Text>
            <Text tone="muted" style={{ textAlign: 'center' }}>
              {s.emptyBody}
            </Text>
          </StandardCard>
        ) : nothingHere ? (
          <StandardCard>
            <Text tone="muted" style={{ paddingVertical: theme.spacing.md, textAlign: 'center' }}>
              {folder && !searching ? s.emptyFolder : s.noMatches}
            </Text>
          </StandardCard>
        ) : grid ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {rows}
          </View>
        ) : (
          <StandardCard style={{ paddingVertical: 0 }}>{rows}</StandardCard>
        )}
      </ScrollView>
      <EditSheet
        edit={edit}
        folderVisibility={folder?.visibility ?? 'everyone'}
        role={view.isOwner ? 'admin' : 'manager'}
        visLabel={visLabel}
        onClose={() => setEdit(null)}
        onSave={async (v) => {
          if (!edit) return;
          try {
            if (edit.mode === 'folder')
              await actions.saveFolder.mutateAsync({
                id: edit.folder?.id,
                name: v.name,
                visibility: v.visibility,
              });
            else if (edit.mode === 'link' && edit.file)
              await actions.update.mutateAsync({
                file: edit.file,
                name: v.name,
                visibility: v.visibility,
                url: v.url,
              });
            else if (edit.mode === 'link')
              await actions.addLink.mutateAsync({
                name: v.name,
                url: v.url,
                visibility: v.visibility,
                folderId,
              });
            else if (edit.mode === 'file')
              await actions.update.mutateAsync({
                file: edit.file,
                name: v.name,
                visibility: v.visibility,
              });
            else
              await actions.upload.mutateAsync({
                uri: edit.uri,
                name: v.name,
                mime: edit.mime,
                folderId,
                visibility: v.visibility,
              });
            setEdit(null);
          } catch (caught) {
            await fail(caught, edit.mode === 'upload' ? s.uploadFailed : s.saveFailed);
          }
        }}
      />
    </Screen>
  );
}

/** Name (and address for a link) plus who can see it. The one sheet for every add and edit. */
function EditSheet({
  edit,
  folderVisibility,
  role,
  visLabel,
  onClose,
  onSave,
}: {
  edit: Edit | null;
  folderVisibility: CompanyFileVisibility;
  role: 'admin' | 'manager';
  visLabel: Record<CompanyFileVisibility, string>;
  onClose: () => void;
  onSave: (v: { name: string; url: string; visibility: CompanyFileVisibility }) => Promise<void>;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyFiles;
  // Keyed on what it edits, so its fields start fresh each time it opens.
  const editKey = !edit
    ? ''
    : edit.mode === 'upload'
      ? edit.uri
      : `${edit.mode}:${(edit.mode === 'folder' ? edit.folder?.id : edit.file?.id) ?? 'new'}`;
  return (
    <Sheet visible={edit !== null} onClose={onClose} closeLabel={t.common.close}>
      {edit ? (
        <EditForm
          key={editKey}
          edit={edit}
          folderVisibility={folderVisibility}
          role={role}
          visLabel={visLabel}
          onSave={onSave}
          theme={theme}
          s={s}
          cancelLabel={t.common.cancel}
          saveLabel={edit.mode === 'upload' ? s.upload : t.common.save}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

function EditForm({
  edit,
  folderVisibility,
  role,
  visLabel,
  onSave,
  theme,
  s,
  cancelLabel,
  saveLabel,
  onClose,
}: {
  edit: Edit;
  folderVisibility: CompanyFileVisibility;
  role: 'admin' | 'manager';
  visLabel: Record<CompanyFileVisibility, string>;
  onSave: (v: { name: string; url: string; visibility: CompanyFileVisibility }) => Promise<void>;
  theme: ReturnType<typeof useTheme>;
  s: ReturnType<typeof useStrings>['t']['companyFiles'];
  cancelLabel: string;
  saveLabel: string;
  onClose: () => void;
}) {
  const existing = edit.mode === 'link' || edit.mode === 'file' ? edit.file : undefined;
  const folder = edit.mode === 'folder' ? edit.folder : undefined;
  const [name, setName] = useState(
    edit.mode === 'upload' ? edit.name : (existing?.name ?? folder?.name ?? ''),
  );
  const [url, setUrl] = useState(existing?.url ?? '');
  const [visibility, setVisibility] = useState<CompanyFileVisibility>(
    existing?.visibility ?? folder?.visibility ?? folderVisibility,
  );
  const [saving, setSaving] = useState(false);
  const cleanUrl = edit.mode === 'link' ? normaliseLinkUrl(url) : '';
  const urlBad = edit.mode === 'link' && url.trim() !== '' && cleanUrl === null;
  const ready = name.trim() !== '' && (edit.mode !== 'link' || cleanUrl !== null);
  const choices = visibilityChoices(role);
  const hint: Record<CompanyFileVisibility, string> = {
    everyone: s.visEveryoneHint,
    managers: s.visManagersHint,
    owners: s.visOwnersHint,
  };
  const field = {
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceMuted,
    color: theme.color.text,
    fontSize: 16,
  } as const;
  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text variant="title">
        {edit.mode === 'folder'
          ? folder
            ? s.rename
            : s.newFolder
          : edit.mode === 'link'
            ? existing
              ? s.editLink
              : s.addLink
            : edit.mode === 'upload'
              ? s.upload
              : s.rename}
      </Text>
      <TextInput
        accessibilityLabel={
          edit.mode === 'folder' ? s.folderName : edit.mode === 'link' ? s.linkName : s.fileName
        }
        placeholder={
          edit.mode === 'folder' ? s.folderName : edit.mode === 'link' ? s.linkName : s.fileName
        }
        placeholderTextColor={theme.color.textMuted}
        value={name}
        onChangeText={setName}
        maxLength={edit.mode === 'folder' ? 80 : 120}
        style={field}
      />
      {edit.mode === 'link' ? (
        <View style={{ gap: theme.spacing.xs }}>
          <TextInput
            accessibilityLabel={s.linkUrl}
            placeholder={s.linkUrl}
            placeholderTextColor={theme.color.textMuted}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={2048}
            style={field}
          />
          {urlBad ? (
            <Text variant="caption" style={{ color: theme.color.negative }}>
              {s.linkUrlBad}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text variant="caption" tone="muted">
        {s.whoSees}
      </Text>
      <View style={{ gap: theme.spacing.xs }}>
        {choices.map((v) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ selected: visibility === v }}
            onPress={() => setVisibility(v)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              minHeight: 48,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: visibility === v ? theme.color.brandSoft : theme.color.surfaceMuted,
            }}
          >
            <Ionicons
              name={visibility === v ? 'radio-button-on' : 'radio-button-off'}
              size={iconSize.md}
              color={visibility === v ? theme.color.brand : theme.color.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600' }}>{visLabel[v]}</Text>
              <Text variant="micro" tone="muted">
                {hint[v]}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      <Row style={{ gap: theme.spacing.sm }}>
        <Button label={cancelLabel} variant="secondary" onPress={onClose} />
        <Button
          label={saving ? s.uploading : saveLabel}
          variant="brand"
          disabled={!ready || saving}
          onPress={async () => {
            setSaving(true);
            try {
              await onSave({ name: name.trim(), url: cleanUrl ?? '', visibility });
            } finally {
              setSaving(false);
            }
          }}
        />
      </Row>
    </View>
  );
}
