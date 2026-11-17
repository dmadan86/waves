/**
 * The space pill and its "Switch space" sheet: Personal or one of the viewer's companies.
 * One component for Home and every company header, so the two never drift apart.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, ScrollView, View } from 'react-native';

import { Sheet, Text, directionalIcon, iconSize, useTheme } from '@waves/ui';

import { BUILDING_ART } from '@/components/company/dashboard/art';
import { useGroupPhotoUrl } from '@/components/GroupPhoto';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useGroups } from '@/data/hooks';
import type { GroupRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useToast } from '@/lib/toast';
import type { Space } from '@/lib/spaces';
import { useViewerCompanyIds, useViewerRole } from '@/lib/useCompanyTab';
import { useRememberSpace } from '@/lib/useSpaces';
import { useViewerIdentity } from '@/lib/viewerIdentity';
import { useVoiceDefaultSpace, useVoiceNewCount } from '@/lib/voiceSpaceStore';

const ROLE_KEY = {
  admin: 'owner',
  manager: 'manager',
  vendor: 'vendor',
} as const;

function Row({
  title,
  body,
  current,
  leading,
  dashed,
  tag,
  dot,
  onPress,
}: {
  title: string;
  /** A small pill beside the title ("Default"). */
  tag?: string;
  /** A "new by voice" dot. */
  dot?: boolean;
  body: string;
  current?: boolean;
  leading: React.ReactNode;
  dashed?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: current ?? false }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: current ? theme.color.brand : theme.color.border,
        backgroundColor: current ? theme.color.brandSoft : theme.color.surface,
      }}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            numberOfLines={1}
            style={{
              fontWeight: '700',
              flexShrink: 1,
              color: current ? theme.color.brand : undefined,
            }}
          >
            {title}
          </Text>
          {tag ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 6,
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Text variant="micro" style={{ color: theme.color.brand, fontWeight: '700' }}>
                {tag}
              </Text>
            </View>
          ) : null}
          {dot ? (
            <View
              accessibilityLabel={t.spaces.newByVoice}
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.brand }}
            />
          ) : null}
        </View>
        <Text variant="caption" tone="muted">
          {body}
        </Text>
      </View>
      <Ionicons
        name={current ? 'checkmark-circle' : directionalIcon('chevron-forward')}
        size={current ? 24 : 20}
        color={current ? theme.color.brand : theme.color.textMuted}
      />
    </Pressable>
  );
}

function CompanyRow({
  group,
  current,
  onPress,
}: {
  group: GroupRow;
  current: boolean;
  onPress: () => void;
}) {
  const { t } = useStrings();
  const role = useViewerRole(group.id);
  const logo = useGroupPhotoUrl(group.photo_path);
  const roleKey = ROLE_KEY[role as keyof typeof ROLE_KEY] ?? 'employee';
  const { defaultId } = useVoiceDefaultSpace();
  const newCount = useVoiceNewCount();
  return (
    <Row
      title={group.name || t.extras.typeCompany}
      tag={defaultId === group.id ? t.spaces.defaultTag : undefined}
      dot={newCount(group.id) > 0}
      body={t.spaces[roleKey]}
      current={current}
      onPress={onPress}
      leading={
        <Image
          source={logo ? { uri: logo } : BUILDING_ART}
          style={{ width: 44, height: 44, borderRadius: 12 }}
        />
      }
    />
  );
}

/** The "Switch space" sheet: Personal, the viewer's companies, and Create a new company. */
export function SpaceSwitchSheet({
  current,
  open,
  onClose,
}: {
  current: Space;
  open: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const remember = useRememberSpace();
  const toast = useToast();
  const companyIds = useViewerCompanyIds();
  const groups = useGroups().data ?? [];
  const companies = companyIds.flatMap((id) => groups.filter((g) => g.id === id));
  const personal = current === 'personal';
  const viewer = useViewerIdentity();

  const go = (space: Space) => {
    onClose();
    if (space === current) return;
    remember(space);
    const name =
      space === 'personal'
        ? t.spaces.personal
        : companies.find((g) => g.id === space)?.name?.trim() || t.company.tab;
    toast.show(fill(t.spaces.switchedTo, { name }));
    const href = space === 'personal' ? '/' : `/group/${space}`;
    if (personal) router.push(href);
    else if (space === 'personal') router.navigate('/');
    else router.replace(href);
  };

  return (
    <Sheet
      visible={open}
      onClose={onClose}
      closeLabel={t.common.close}
      title={t.spaces.switchTitle}
    >
      <ScrollView contentContainerStyle={{ gap: 10 }}>
        <Text variant="caption" tone="muted">
          {t.spaces.switchBody}
        </Text>
        <Row
          title={t.spaces.personal}
          body={t.spaces.personalBody}
          current={personal}
          onPress={() => go('personal')}
          leading={<PersonAvatar name={viewer.name} avatarUrl={viewer.avatarUrl} size={44} />}
        />
        {companies.map((g) => (
          <CompanyRow key={g.id} group={g} current={g.id === current} onPress={() => go(g.id)} />
        ))}
        <Row
          dashed
          title={t.spaces.createTitle}
          body={t.spaces.createBody}
          onPress={() => {
            onClose();
            router.push('/new-company');
          }}
          leading={<Ionicons name="add-circle-outline" size={44} color={theme.color.brand} />}
        />
      </ScrollView>
    </Sheet>
  );
}

/** `current` is 'personal' or the open company's id; `label` is what the pill says. */
export function SpacePill({ current, label }: { current: Space; label: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const [open, setOpen] = useState(false);
  const companyIds = useViewerCompanyIds();
  // Only-groups users have nothing to switch to: a plain label, no chevron, no sheet.
  const switchable = companyIds.length > 0;
  const personal = current === 'personal';

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={switchable ? `${label}, ${t.spaces.pillLabel}` : label}
        disabled={!switchable}
        onPress={() => setOpen(true)}
        style={{
          alignSelf: 'flex-start',
          maxWidth: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.color.surface,
          borderWidth: 1,
          borderColor: theme.color.border,
        }}
      >
        <Ionicons
          name={personal ? 'person-circle' : 'business'}
          size={iconSize.lg}
          color={theme.color.brand}
        />
        <Text numberOfLines={1} style={{ fontWeight: '700', flexShrink: 1 }}>
          {label}
        </Text>
        {switchable ? (
          <Ionicons name="chevron-down" size={iconSize.md} color={theme.color.text} />
        ) : null}
      </Pressable>
      {switchable ? (
        <SpaceSwitchSheet current={current} open={open} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
