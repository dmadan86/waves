/** The two small couple additions to the Rentals screen: a new-phone notice and the former-couple list. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { StandardCard } from '@/components/standard';
import { useGroup } from '@/data/hooks';
import { dismissPhoneNotice, useFormerCouples, useNewPhoneNotices } from '@/e2ee/runtime';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

/** "<Name> added a new phone." One dismissable line per new partner phone. */
export function NewPhoneNotice({ groupId }: { groupId?: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const notices = useNewPhoneNotices(groupId);
  const members = useGroup(groupId ?? '').members.data;
  if (!groupId || notices.length === 0) return null;
  return (
    <>
      {notices.map((n) => {
        const m = members?.find((x) => x.id === n.memberId);
        const name = m?.profile?.display_name ?? m?.ghost_name ?? '';
        return (
          <Row key={n.deviceId} style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Ionicons name="phone-portrait-outline" size={iconSize.sm} color={theme.color.brand} />
            <Text variant="caption" style={{ flex: 1 }}>
              {fill(t.wealth.phoneAdded, { name })}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.wealth.dismiss}
              hitSlop={10}
              onPress={() => void dismissPhoneNotice(n.deviceId)}
            >
              <Ionicons name="close" size={iconSize.sm} color={theme.color.textMuted} />
            </Pressable>
          </Row>
        );
      })}
    </>
  );
}

/** Couples this phone has left: read-only, on this phone only. Opens the same Rentals screen. */
export function FormerCouples() {
  const theme = useTheme();
  const { t } = useStrings();
  const former = useFormerCouples();
  if (former.length === 0) return null;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
        {t.wealth.formerCouplesTitle}
      </Text>
      {former.map((f) => (
        <Pressable
          key={f.groupId}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/rentals', params: { space: f.groupId } })}
        >
          <StandardCard>
            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Ionicons
                name="heart-dislike-outline"
                size={iconSize.md}
                color={theme.color.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text variant="body" style={{ fontWeight: '700' }}>
                  {fill(t.wealth.formerCouple, { name: f.name })}
                </Text>
                <Text variant="micro" tone="muted">
                  {t.wealth.formerCoupleNote}
                </Text>
              </View>
            </Row>
          </StandardCard>
        </Pressable>
      ))}
    </View>
  );
}
