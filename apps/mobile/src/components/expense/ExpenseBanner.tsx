/**
 * The banner the group add-expense form opens on: the beach scene with the
 * back arrow, the form's title and the name of the group it lands in.
 *
 * The same scene the import flow wears (`ImportHero`). The suitcase sits on the
 * right, so the picture is anchored there and the sky fades into the page
 * behind the text and the sand into the cards beneath. The amount card is laid
 * over its bottom edge by the caller. It runs under the status bar, so the
 * safe-area top is part of its height.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useGoBack } from '@/lib/navigation';

/** The plain top of the expense form: back chevron, title, and the group under it. */
export function ExpenseBanner({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useStrings();
  const goBack = useGoBack();
  return (
    <View
      style={{
        // The scroll content is padded in from the screen edge; the bar is not.
        marginHorizontal: -theme.spacing.lg,
        paddingTop: insets.top + theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
      }}
    >
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel={t.common.back}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 40,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <Ionicons
          name={directionalIcon('chevron-back')}
          size={iconSize.xl}
          color={theme.color.text}
        />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="heading" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
