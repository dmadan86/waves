import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { GroupType } from '@/data/types';
import { useStrings } from '@/i18n';
import { groupTypeTag, type GroupTypeTag as GroupTypeTagValue } from '@/lib/groupTypeTag';
import { GROUP_TYPE_ICON } from '@/components/DestinationPicker';

/** The tag for a group, in the reader's language — null when the group has no
 *  meaningful type to show. */
export function useGroupTypeTag(
  type: string | null | undefined,
  eventTemplate: string | null | undefined,
): GroupTypeTagValue | null {
  const { t } = useStrings();
  return groupTypeTag(type, eventTemplate, {
    types: {
      trip: t.extras.typeTrip,
      home: t.extras.typeHome,
      couple: t.extras.typeCouple,
      event: t.extras.typeEvent,
      friends: t.extras.typeFriends,
    },
    events: t.eventOrganizer.tagNames,
  });
}

/** The spoken form — "Kind: Trip" — for an accessibility label. */
export function useGroupTypeTagSpoken(tag: GroupTypeTagValue | null): string | null {
  const { t } = useStrings();
  return tag ? `${t.extras.groupKind}: ${tag.label}` : null;
}

/**
 * A compact pill — glyph and short word — saying what kind of group this is.
 * Tinted per type from the theme's soft tokens (so dark mode follows); on the
 * brand hero it turns to a translucent white pill instead. Decorative to a
 * screen reader: the containing row speaks the type in its own label.
 */
export function GroupTypeTag({
  tag,
  onBrand = false,
}: {
  tag: GroupTypeTagValue;
  onBrand?: boolean;
}) {
  const theme = useTheme();
  const tint = (() => {
    switch (tag.type) {
      case GroupType.Home:
        return { bg: theme.color.positiveSoft, fg: theme.color.positive };
      case GroupType.Couple:
        return { bg: theme.color.negativeSoft, fg: theme.color.negative };
      case GroupType.Event:
        return { bg: theme.color.warningSoft, fg: theme.color.warning };
      case GroupType.Friends:
        return { bg: theme.color.surfaceMuted, fg: theme.color.textMuted };
      default:
        return { bg: theme.color.brandSoft, fg: theme.color.brand };
    }
  })();
  const bg = onBrand ? 'rgba(255,255,255,0.18)' : tint.bg;
  const fg = onBrand ? theme.color.onBrand : tint.fg;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: theme.radius.pill,
        backgroundColor: bg,
      }}
    >
      <Ionicons name={GROUP_TYPE_ICON[tag.type]} size={11} color={fg} />
      <Text variant="micro" numberOfLines={1} style={{ color: fg, fontWeight: '600' }}>
        {tag.label}
      </Text>
    </View>
  );
}
