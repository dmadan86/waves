import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, View } from 'react-native';

import { maskValue, type DetailsCard } from '../../../../../../packages/core/src/company/details';
import { Text, directionalIcon, iconSize, useTheme } from '@waves/ui';

import { IconDisc } from '@/components/company/dashboard/overviewKit';
import { StandardCard } from '@/components/standard';
import { useGroup } from '@/data/hooks';
import { plural, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

type Icon = keyof typeof Ionicons.glyphMap;

function Row({
  icon,
  title,
  value,
  onPress,
  last,
}: {
  icon: Icon;
  title: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={value ? `${title}, ${value}` : title}
      onPress={onPress}
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.color.border,
      }}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
      <Text style={{ flexShrink: 0 }}>{title}</Text>
      <Text tone="muted" numberOfLines={2} style={{ flex: 1, textAlign: 'right' }}>
        {value ?? ''}
      </Text>
      {onPress ? (
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.sm}
          color={theme.color.textMuted}
        />
      ) : null}
    </Pressable>
  );
}

function SetupRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: Icon;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      onPress={onPress}
      style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
    >
      <IconDisc ink={theme.color.brand} size={36}>
        <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
      </IconDisc>
      <View style={{ flex: 1 }}>
        <Text variant="body" style={{ fontWeight: '700' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted">
          {subtitle}
        </Text>
      </View>
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.sm}
        color={theme.color.textMuted}
      />
    </Pressable>
  );
}

/** The company details screen's top: hero, key facts, team and setup shortcuts. The full card stays below. */
export function CompanyDetailsSections({
  groupId,
  card,
  canEdit,
  onEdit,
}: {
  groupId: string;
  card: DetailsCard | null;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.companyDetails;
  const { group, members } = useGroup(groupId);
  const name = group.data?.name ?? s.title;
  const count = members.data.filter((m) => !m.left_at).length;
  const v = card?.values;
  const edit = canEdit ? onEdit : undefined;
  const go = (path: string) => () => router.push(`/group/${groupId}/${path}`);
  return (
    <View style={{ gap: theme.spacing.md }}>
      <LinearGradient
        colors={[theme.color.brandSoft, theme.color.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: theme.radius.lg,
          padding: theme.spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name="business" size={28} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="heading" numberOfLines={2}>
            {name}
          </Text>
          <View
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: theme.color.positiveSoft,
            }}
          >
            <Ionicons name="checkmark" size={14} color={theme.color.positive} />
            <Text variant="caption" style={{ color: theme.color.positive }}>
              {s.active}
            </Text>
          </View>
        </View>
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.edit}
            onPress={onEdit}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.surface,
            }}
          >
            <Ionicons name="pencil" size={iconSize.md} color={theme.color.brand} />
          </Pressable>
        ) : null}
      </LinearGradient>

      <Text variant="body" style={{ fontWeight: '700' }}>
        {s.companyInfo}
      </Text>
      <StandardCard style={{ gap: theme.spacing.sm }}>
        <Row icon="document-text-outline" title={s.legalName} value={name} />
        <Row
          icon="card-outline"
          title={s.pan}
          value={v?.pan ? maskValue(v.pan) : undefined}
          onPress={edit}
        />
        <Row icon="receipt-outline" title={s.gstin} value={v?.gstin ?? undefined} onPress={edit} />
        <Row
          icon="location-outline"
          title={s.address}
          value={v?.address ?? undefined}
          onPress={edit}
          last
        />
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.addMore}
            onPress={onEdit}
            style={{
              minHeight: 44,
              borderRadius: theme.radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Text variant="body" style={{ fontWeight: '700', color: theme.color.brand }}>
              + {s.addMore}
            </Text>
          </Pressable>
        ) : null}
      </StandardCard>

      <Text variant="body" style={{ fontWeight: '700' }}>
        {s.peopleAccess}
      </Text>
      <StandardCard>
        <SetupRow
          icon="people-outline"
          title={s.teamMembers}
          subtitle={plural(locale, count, t.memberCount)}
          onPress={go('company-people')}
        />
      </StandardCard>

      <Text variant="body" style={{ fontWeight: '700' }}>
        {s.businessSetup}
      </Text>
      <StandardCard style={{ gap: theme.spacing.sm }}>
        <SetupRow
          icon="wallet-outline"
          title={s.billing}
          subtitle={s.billingSub}
          onPress={go('company-payments')}
        />
        <SetupRow
          icon="options-outline"
          title={s.preferences}
          subtitle={s.preferencesSub}
          onPress={go('settings')}
        />
      </StandardCard>
    </View>
  );
}
