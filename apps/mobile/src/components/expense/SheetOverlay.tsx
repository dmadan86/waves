/**
 * The sheet primitive the expense forms share, and the row a sheet's choices
 * are listed in.
 *
 * Both the capture screen and the group add-expense screen present their
 * pickers (currency, destination) as a bottom sheet over the form, and list
 * their choices as a leading glyph + label + check. Pulling them here means the
 * two screens present, dismiss, and read the same rather than each carrying its
 * own copy that could drift apart.
 *
 * This file used to also hold the row a sheet's *result* was stated in —
 * `FieldRow` (name stacked over value) and `SettingRow` (name and value on one
 * line, the shape this file was named for). Both are gone: every caller of
 * either now uses `DetailRow` from `@/components/DetailRows`, which is the
 * shape the expense screen already stated a filed bill's facts in. A field
 * asked on a form and read back on the receipt now looks like the same
 * question both times. See that file's header for the fuller reasoning and
 * for what still stays a different row (`ListRow` in `@waves/ui`, for an entry
 * you open rather than a fact you're told).
 */

import { type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { iconSize, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';

/**
 * A bottom sheet over the form: a dimmed backdrop that closes on tap, a rounded
 * card that swallows its own taps, a grab handle and a title. The pickers on the
 * expense screens (currency, group) share it so they present and dismiss the
 * same way.
 */
export function SheetOverlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  // The foot this sheet leaves at the bottom edge.
  //
  // Route-aware, because this sheet is drawn in the screen's own tree rather
  // than in a modal window of its own. A modal would be a separate native window
  // and would cover everything; this is a view inside the page, and the app's
  // bottom bar is a later sibling at the root — it paints *over* the sheet, scrim
  // and all. So on any route where the bar is showing (the Activity feed's date
  // filter, say) the sheet has to clear the bar as well as the system navigation
  // inset, or its last control ends up behind the bar and cannot be tapped at
  // all. On a route the bar hides on (add-expense, capture) the plain screen foot
  // is right, and `useBottomClearance` knows which is which.
  const foot = useBottomClearance(theme.spacing.xl);

  // Drag the handle down to dismiss. translateY only ever goes positive (down);
  // past a short threshold or on a quick flick the sheet closes, otherwise it
  // springs back. The gesture lives on the header, not the whole card, so it
  // never fights the list's own vertical scroll.
  const translateY = useSharedValue(0);
  const dragToClose = Gesture.Pan()
    // Only engage once the finger has clearly moved vertically, so a plain tap
    // on the handle still falls through to the Pressable that closes the sheet.
    .activeOffsetY([-12, 12])
    .onUpdate((event) => {
      // Down follows the finger 1:1; an upward pull rubber-bands so the sheet
      // feels anchored rather than free.
      translateY.set(event.translationY > 0 ? event.translationY : event.translationY / 4);
    })
    .onEnd((event) => {
      if (translateY.get() > 120 || event.velocityY > 800) {
        // Carry the flick through: animate the rest of the way out, then close.
        translateY.set(withTiming(700, { duration: 180 }, () => runOnJS(onClose)()));
      } else {
        translateY.set(withSpring(0, { damping: 20, stiffness: 220 }));
      }
    });
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.common.close}
      onPress={onClose}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(10, 10, 26, 0.55)',
        justifyContent: 'flex-end',
        // Being last in the tree is enough on iOS, but not on Android: there a
        // raised view paints above every unraised sibling whatever the order,
        // and this app's cards are raised (`shadow.soft` is elevation 4,
        // `shadow.lifted` 10, the pill tab bar 6). A sheet with no elevation of
        // its own therefore opened *underneath* the content it covers — the
        // Activity feed's cards showed through the backdrop. Sit above all of
        // them, with the matching zIndex so the web build orders it the same.
        zIndex: 100,
        elevation: 24,
      }}
    >
      <Animated.View
        style={[
          {
            backgroundColor: theme.color.surface,
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            padding: theme.spacing.xl,
            paddingBottom: foot,
            gap: theme.spacing.md,
            maxHeight: '75%',
          },
          cardStyle,
        ]}
      >
        {/* Swallow taps on the card so they never reach the backdrop, which
            would close the sheet. */}
        <Pressable onPress={() => {}} style={{ gap: theme.spacing.md, flexShrink: 1 }}>
          {/* The header is the drag surface AND a tap-to-close target: the grab
              handle reads as draggable, so make it do something when pushed. */}
          <GestureDetector gesture={dragToClose}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.common.close}
              onPress={onClose}
              style={{ gap: theme.spacing.md }}
            >
              <View
                style={{
                  alignSelf: 'center',
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.color.border,
                }}
              />
              <Text variant="heading">{title}</Text>
            </Pressable>
          </GestureDetector>
          {/* flexShrink lets this scroll: without it the list keeps its full
              content height and the sheet's maxHeight clips the overflow instead
              of scrolling it, so a long group or currency list loses its bottom
              rows. */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={{ flexShrink: 1 }}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Animated.View>
    </Pressable>
  );
}

/** One row in a picker sheet — a leading glyph, a label, a check when chosen. */
export function ChoiceRow({
  leading,
  label,
  selected,
  onPress,
}: {
  leading: ReactNode;
  label: string;
  /**
   * Whether this is the chosen option. Omit for a row that is an *action*
   * rather than one of the choices — "New tag" at the foot of the category
   * sheet — so a screen reader is told it is a button and not that it is an
   * option you have not selected.
   */
  selected?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {leading}
      <Text
        variant="body"
        numberOfLines={1}
        style={{ flex: 1, color: selected ? theme.color.brand : theme.color.text }}
      >
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} /> : null}
    </Pressable>
  );
}
