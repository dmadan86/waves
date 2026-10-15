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
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { I18nManager, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useGoBack } from '@/lib/navigation';

// The beach behind the title; the suitcase sits on the right, clear of the text.
const BANNER = require('../../../assets/images/import-banner.webp') as number;
/** The scene's own height, below the status bar. */
const BANNER_HEIGHT = 124;

export function ExpenseBanner({
  title,
  subtitle,
}: {
  title: string;
  /** The group the expense is being added to. */
  subtitle: string;
}): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useStrings();
  const goBack = useGoBack();
  const rtl = I18nManager.isRTL;
  return (
    <View
      style={{
        height: insets.top + BANNER_HEIGHT,
        // The scroll content is padded in from the screen edge; the picture is not.
        marginHorizontal: -theme.spacing.xl,
        paddingTop: insets.top,
      }}
    >
      <Image
        source={BANNER}
        contentFit="cover"
        contentPosition={rtl ? 'left' : 'right'}
        style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}
        accessibilityIgnoresInvertColors
      />
      {/* The sky fades to the page behind the text, and the sand into the cards. */}
      <LinearGradient
        colors={[theme.color.bg, `${theme.color.bg}00`]}
        start={{ x: rtl ? 1 : 0, y: 0 }}
        end={{ x: rtl ? 0 : 1, y: 0 }}
        locations={[0.2, 0.62]}
        style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}
      />
      <LinearGradient
        colors={[`${theme.color.bg}00`, theme.color.bg]}
        locations={[0.7, 1]}
        style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}
      />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
        }}
      >
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
        >
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.xl}
            color={theme.color.text}
          />
        </Pressable>
        <View style={{ flexShrink: 1, maxWidth: '62%' }}>
          <Text variant="heading" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>
    </View>
  );
}
