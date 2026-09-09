import { memo, useRef, type ReactNode } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { spacing } from '../tokens';
import { useSingleAction } from '../useSingleAction';
import { Text } from './Text';

export interface PillTabItem {
  key: string;
  label: string;
  /** Receives the resolved colour so icons match the active/inactive state. */
  icon: (color: string, focused: boolean) => ReactNode;
}

/**
 * A raised round button in the middle of the bar — a primary quick action that
 * sits above the destinations rather than beside them, the way many apps lift
 * their "+" or record button. Optional: without it the bar is a flat row.
 *
 * It can be a press-and-hold control as well as a tap one. Give it `onPressIn`
 * and the action starts the instant the finger lands, which is the only way a
 * hold-to-talk button can work: waiting for a long-press timer costs half a
 * second, and half a second of a spoken sentence is a whole word. `onPress`
 * still fires for a plain tap — and, importantly, for a screen reader's or a
 * keyboard's activation, which produce no touch at all. Both paths must lead
 * somewhere: a hold is a shortcut, never the only way in.
 */
export interface PillTabAction {
  icon: (color: string) => ReactNode;
  /**
   * Activated. For a touch this is the release; for a screen reader or keyboard
   * it is the whole interaction. When `onPressIn` is given, this is *not* called
   * for the gesture that press-in already handled — so a caller may act in both
   * without acting twice.
   */
  onPress: () => void;
  accessibilityLabel: string;
  /** Read after the label by a screen reader — say that holding works too. */
  accessibilityHint?: string;
  /** The finger has landed. Providing this makes the button hold-capable. */
  onPressIn?: () => void;
  /** The finger has lifted, or the gesture was cancelled. */
  onPressOut?: () => void;
  /**
   * How far the finger has travelled from where it landed, in points, while it
   * is still down. What a slide-to-cancel is built from; the direction is the
   * caller's business, since it flips with the writing direction.
   */
  onHoldMove?: (offset: { dx: number; dy: number }) => void;
}

/** The bar's own content height, above the system inset. WhatsApp sits ~56–64. */
const BAR_HEIGHT = 60;

/** The raised centre button's diameter, and how far it lifts above the bar. */
const CENTER_SIZE = 58;
const CENTER_RAISE = 16;
/**
 * The breath left above and below the centre button when it is seated in the
 * row — what the raise lifts it *from*. Both halves of the geometry are derived
 * from it: where the button is drawn, and how far its touch area reaches back
 * down to the bar's foot.
 */
const CENTER_SEAT = (BAR_HEIGHT - CENTER_SIZE) / 2;

/** The rounded active indicator behind the selected icon (Material 3). */
const INDICATOR_WIDTH = 56;
const INDICATOR_HEIGHT = 30;

/**
 * How much room a screen under the bar has to leave at its foot.
 *
 * The bar is anchored flush to the bottom edge and is opaque, so a list has to
 * end above it rather than scroll behind it. Derived from the bar height plus
 * the system inset — both move with the phone, which is the half a hardcoded
 * number gets wrong — with a small breath so the last row is not jammed to the
 * bar's top edge.
 *
 * This is what nearly every scrolling screen wants, not just the four tabs: the
 * bar is rendered once at the root over the whole navigation stack (`AppTabBar`),
 * so a pushed group, settings or personal screen carries it too. The exceptions
 * are the routes named in `TAB_BAR_HIDDEN_ROUTES` (`apps/mobile/src/lib/tabBar.ts`)
 * and anything reached without a session, which want `useScreenClearance`.
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + BAR_HEIGHT + spacing.lg;
}

/**
 * How much room a scrolling screen that is NOT under the app's own bottom bar
 * has to leave at its foot.
 *
 * One place decides which screens those are: `TAB_BAR_HIDDEN_ROUTES` in
 * `apps/mobile/src/lib/tabBar.ts`, the set of route names the bar hides itself
 * on — plus anything reached without a session, which the same module handles.
 * Go and read that set; do not trust a list written here. It is edited every
 * time a screen is added, so a copy in this comment would be stale within a
 * release, and a stale copy is worse than none: it reads as authority. If the
 * route is not in the set, the bar is over the screen and it wants
 * `useTabBarClearance` instead. (For the shape of it: the full-screen camera and
 * the add-an-expense sheet are in the set today; a pushed group, settings or
 * personal screen is not.)
 *
 * Being *pushed* is not the test, and reading it that way is what left the plan
 * screen's last day under the bar: the bar lives at the root and stays on top of
 * pushed screens too. The one thing this reserves is the system navigation bar
 * (gesture pill or the three buttons), which sits *over* the content because the
 * app draws edge-to-edge — a fixed `paddingBottom` cannot know its height, so
 * the last row ends up under the system UI. Pass a larger `base` on a screen
 * with a floating action or a pinned footer.
 *
 * Not only screens: anything whose last row is the last thing above the system
 * bar asks the same question and must get the same answer — a bottom sheet's
 * foot (`Sheet`), and a pinned action bar that carries the inset itself so its
 * fill reaches the screen edge instead of floating on a strip of page colour.
 * The arithmetic is trivial, which is exactly why it had been written out by
 * hand in three other places; there is one of it now.
 *
 * `Sheet` is the interesting case, and the reason it is *this* helper and not
 * `useTabBarClearance`: a sheet drawn in a `Modal` gets its own native window
 * above everything the app has drawn, bottom bar included, so the only thing
 * under it is the system's own bar. A sheet drawn inside the page instead — the
 * expense forms' `SheetOverlay` — is painted *under* that bar and has to clear
 * it as well; the app answers that one with `useBottomClearance`, which picks
 * between these two hooks by asking whether the bar is showing on this route.
 */
export function useScreenClearance(base: number = spacing.xxxl): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + base;
}

/**
 * The bottom navigation, WhatsApp / Material 3 style: a flat opaque bar pinned
 * to the bottom edge, a hairline along its top, and each destination drawn as
 * an icon over its label. The selected destination wears a rounded "active
 * indicator" pill behind its icon in the brand's soft tint, and its icon and
 * label take the brand colour — the rest sit muted.
 *
 * `animated` gives the pressed target a small dip under the finger. It defaults
 * off so the bar is still unless a caller opts in — the tabs layout passes the
 * app's motion preference, so reduce-motion keeps the plain switch.
 *
 * `centerAction`, when given, is a raised round button dropped into the middle
 * of the row: the destinations split evenly around it.
 */
export function PillTabBar({
  items,
  activeKey,
  onSelect,
  animated = false,
  centerAction,
}: {
  items: readonly PillTabItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  animated?: boolean;
  centerAction?: PillTabAction;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // With a centre action the destinations split into two halves around it; the
  // extra one, when the count is odd, sits on the left.
  const middle = centerAction ? Math.ceil(items.length / 2) : items.length;
  const left = items.slice(0, middle);
  const right = items.slice(middle);

  const renderItem = (item: PillTabItem): ReactNode => (
    <TabItem
      key={item.key}
      item={item}
      focused={item.key === activeKey}
      animated={animated}
      onSelect={onSelect}
    />
  );

  // The bar's touch area has to be taller than its paint by exactly the raise.
  // A view drawn outside its parent's bounds is still *painted* — neither
  // platform clips it here — but it is never offered the touch: hit testing
  // walks down from the root and only descends into a view that contains the
  // point, so a circle lifted 16pt above a 60pt bar had its top 15pt visible,
  // inviting, and completely dead. That is the part of a raised button a thumb
  // aims at. So the bar lives inside a taller box, and the button is drawn in
  // an overlay that fills it — nothing is outside its parent any more.
  const raise = centerAction ? CENTER_RAISE : 0;

  return (
    <View
      // Only the bar and the button answer; the strip of headroom either side of
      // the button belongs to the screen behind it, which keeps scrolling.
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: BAR_HEIGHT + insets.bottom + raise,
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          // The inset is padding, not margin, so the bar's fill runs all the way
          // to the screen edge behind the system navigation buttons rather than
          // leaving a strip of content showing beneath it.
          paddingBottom: insets.bottom,
          height: BAR_HEIGHT + insets.bottom,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.color.surface,
          borderTopWidth: 1,
          borderTopColor: theme.color.border,
        }}
      >
        {left.map(renderItem)}
        {/* The centre button's column, held open so the destinations still split
            evenly around it. The button itself is drawn in the overlay below. */}
        {centerAction ? <View style={{ flex: 1 }} /> : null}
        {right.map(renderItem)}
      </View>

      {centerAction ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            flexDirection: 'row',
          }}
        >
          {/* The same flex weights as the row beneath, so the button lands over
              the column left open for it whichever way the writing runs — both
              rows flip together. The flanks are inert: they lie over the
              destinations, and a live view here would swallow their taps. */}
          <View pointerEvents="none" style={{ flex: left.length }} />
          <View
            pointerEvents="box-none"
            style={{
              flex: 1,
              alignItems: 'center',
              // Seated as it would be centred in the bar's own row — the box's
              // extra headroom above the bar is what the raise then buys.
              paddingTop: CENTER_SEAT,
            }}
          >
            <CenterButton action={centerAction} />
          </View>
          <View pointerEvents="none" style={{ flex: right.length }} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * How far outside the button the finger may wander before React Native calls
 * the press off. Generous, because a hold-capable button is *meant* to be slid
 * across: the caller's own cancel threshold should be what ends the gesture, not
 * Pressability's, and a press RN cancels delivers no `onPress` to balance the
 * `onPressIn` that opened it.
 */
const HOLD_RETENTION = { top: 140, bottom: 140, left: 200, right: 200 };

/** The raised round action in the middle of the bar. */
const CenterButton = memo(function CenterButton({ action }: { action: PillTabAction }) {
  const theme = useTheme();
  const holdable = action.onPressIn != null;
  // Where the finger landed, so a move can be reported as a distance rather
  // than a screen coordinate. Null between gestures.
  const origin = useRef<{ x: number; y: number } | null>(null);
  // A touch gesture acted on press-in, so the `onPress` closing that same
  // gesture must not act again. It is consumed by the press it belongs to; a
  // gesture React Native cancels delivers no press at all, so it is dropped on
  // the way out too — a beat later, because Pressability fires `onPressOut`
  // immediately before `onPress` in the same tick, and clearing it inline would
  // let that press straight through.
  const handled = useRef(false);
  // The tap path only. A hold acts on press-in and is deliberately untouched:
  // it is one continuous gesture, not a repeat, and it has its own bookkeeping
  // in `handled` above.
  const tap = useSingleAction(action.onPress);

  // The column and the seating are the bar's business (it has to place this
  // over the gap it left in the row); what is here is the button.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel}
      accessibilityHint={action.accessibilityHint}
      onPress={() => {
        if (handled.current) {
          handled.current = false;
          return;
        }
        tap?.();
      }}
      onPressIn={(event) => {
        const press = action.onPressIn;
        if (!press) return;
        handled.current = true;
        origin.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
        press();
      }}
      onPressOut={() => {
        origin.current = null;
        const release = action.onPressOut;
        if (!release) return;
        release();
        setTimeout(() => {
          handled.current = false;
        }, 0);
      }}
      // A raw touch handler rather than the responder callbacks: Pressability
      // owns the responder here, and anything we passed for it would be
      // overwritten by the handlers Pressable spreads on after ours.
      onTouchMove={(event) => {
        const from = origin.current;
        const move = action.onHoldMove;
        if (!from || !move) return;
        move({
          dx: event.nativeEvent.pageX - from.x,
          dy: event.nativeEvent.pageY - from.y,
        });
      }}
      pressRetentionOffset={holdable ? HOLD_RETENTION : undefined}
      // The button owns its whole column of the bar. Reaching back down to the
      // bar's foot is the point: the strip under a lifted circle reads as part
      // of it, and left to the row beneath it answered to nothing — a hole in
      // the middle of the bar between the two halves of the destinations. The
      // sides stop a hair short of the neighbouring tabs.
      hitSlop={{
        top: CENTER_SEAT,
        bottom: CENTER_RAISE + CENTER_SEAT,
        left: 8,
        right: 8,
      }}
      style={({ pressed }) => ({
        width: CENTER_SIZE,
        height: CENTER_SIZE,
        borderRadius: CENTER_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.buttonPrimary,
        opacity: pressed ? 0.9 : 1,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      })}
    >
      {action.icon(theme.color.onBrand)}
    </Pressable>
  );
});

const TabItem = memo(function TabItem({
  item,
  focused,
  animated,
  onSelect,
}: {
  item: PillTabItem;
  focused: boolean;
  animated: boolean;
  onSelect: (key: string) => void;
}) {
  const theme = useTheme();

  // Core Animated on the native driver: the press scale is a transform the UI
  // thread owns, so it never waits on JavaScript. Kept out of the UI package's
  // dependencies on purpose — the one bit of motion the shared kit needs.
  const scale = useRef(new Animated.Value(1)).current;

  const press = (to: number): void => {
    if (!animated) return;
    Animated.spring(scale, {
      toValue: to,
      damping: 18,
      stiffness: 280,
      mass: 0.5,
      useNativeDriver: true,
    }).start();
  };

  const ink = focused ? theme.color.brand : theme.color.textMuted;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={item.label}
      onPress={() => {
        if (!focused) onSelect(item.key);
      }}
      onPressIn={() => press(0.9)}
      onPressOut={() => press(1)}
      style={{ flex: 1 }}
    >
      <Animated.View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          transform: [{ scale }],
        }}
      >
        <View
          style={{
            width: INDICATOR_WIDTH,
            height: INDICATOR_HEIGHT,
            // A fixed stadium radius, larger than the box, so the ends stay
            // fully round however the box is measured — half-the-height reads as
            // square for the frame before layout settles the exact height.
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            backgroundColor: focused ? theme.color.brandSoft : 'transparent',
          }}
        >
          {item.icon(ink, focused)}
        </View>
        <Text
          variant="micro"
          tone={focused ? 'brand' : 'muted'}
          style={{ fontWeight: focused ? '700' : '600' }}
        >
          {item.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
});
