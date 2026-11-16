/**
 * "N added by voice — review": the slim strip over a space's list while entries
 * spoken into it are still unseen. Tapping it, or leaving the list, marks them seen
 * (which also clears the dot on the space's Home card).
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { Pressable } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import { plural, useStrings } from '@/i18n';
import { useVoiceAdded, useVoiceNewCount } from '@/lib/voiceSpaceStore';

export function VoiceAddedStrip({
  groupId,
  live,
}: {
  groupId: string;
  /** The ids on the list now, so a deleted or moved entry is not counted. */
  live?: ReadonlySet<string>;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { newIds, markSeenNow } = useVoiceAdded();
  const newCount = useVoiceNewCount();
  useFocusEffect(() => () => markSeenNow(groupId));
  const count = live ? newIds(groupId, live).length : newCount(groupId);
  if (count === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => markSeenNow(groupId)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: theme.color.brandSoft,
        borderRadius: theme.radius.md,
        paddingHorizontal: theme.spacing.md,
        minHeight: 40,
      }}
    >
      <Ionicons name="mic-outline" size={iconSize.md} color={theme.color.brand} />
      <Text variant="caption" style={{ flex: 1 }}>
        {plural(locale, count, t.spaces.addedByVoice)}
      </Text>
    </Pressable>
  );
}
