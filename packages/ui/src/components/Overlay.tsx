/**
 * The two overlay motions the whole app shares: a bottom Sheet and a centred
 * Popup.
 *
 * Every transient surface — a picker, a confirm dialog, a quick-add menu — used
 * to reach for React Native's `Modal` directly and pick `animationType="fade"`
 * or `"slide"` by hand, so a "sheet" sometimes cross-faded and a dialog blinked
 * on with no arrival at all. These two components are the one implementation of
 * that motion, WhatsApp's grammar: a Sheet springs up from the bottom edge under
 * a fading scrim, a Popup fades in while scaling up from just under full size.
 *
 * Built on RN's own `Animated`, not Reanimated: the design system carries no
 * animation dependency, and opacity + translate + scale on the native driver is
 * exactly what `Animated` is good at. Each surface is held mounted by a latch
 * through its close, so the exit plays instead of the content vanishing the
 * instant `visible` flips — `Modal`'s own `animationType` would unmount too soon
 * for that. Reduced motion keeps the fade and drops the travel and the scale.
 *
 * One structural rule holds in both: **the tap-away scrim is a sibling of the
 * card, never its parent.** A `Pressable` is an accessibility element, and an
 * accessibility element hides everything inside it — wrapping the card in the
 * scrim meant a screen reader found one button called "Close" where the title,
 * the rows and the doors should have been. So the scrim is an absolutely-filled
 * layer underneath, and the card sits over it in a `box-none` frame that lets
 * taps beside the card fall through to the scrim.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { useScreenClearance } from './PillTabBar';
import { Text } from './Text';

/**
 * The scrim behind every overlay.
 *
 * Deep enough that what it covers reads as *dimmed*, not as a paler version of
 * itself. At the old 0.55 a white card under the scrim came out at #787880 and
 * the lavender page around it at #737380 — five levels apart, which is enough
 * for the eye to pick the card out as a bright slab floating behind the sheet.
 * The app is a light one: almost everything behind an overlay is white or near
 * it, so the wash has to do more work here than it would over a dark app.
 */
const SCRIM = 'rgba(10, 10, 26, 0.7)';

/**
 * The orientations every `Modal` in the app must allow on iOS — the same two
 * the app itself does (`"orientation": "portrait"` in app.json gives iOS both
 * portrait and upside-down). React Native's `Modal` defaults to portrait alone,
 * so on a device held upside-down, presenting one rotated the whole app for a
 * frame or two on the way in and again on the way out: a flicker behind every
 * sheet and pop-up. Android ignores the prop.
 */
export const MODAL_ORIENTATIONS: ('portrait' | 'portrait-upside-down')[] = [
  'portrait',
  'portrait-upside-down',
];
/** Past this far down, or this fast, a drag on the handle dismisses. */
const DRAG_CLOSE_DISTANCE = 120;
const DRAG_CLOSE_VELOCITY = 0.8;
const OPEN_SPRING = { tension: 70, friction: 12 } as const;
const CLOSE_MS = 160;
/** How small a Popup starts — a grow into place, not a pop from nothing. */
const POPUP_START_SCALE = 0.92;

/**
 * The OS reduce-motion flag, read locally so the design system does not depend
 * on the app's motion context. Starts true so the very first frame never travels
 * before the real value lands.
 */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(true);
  useEffect(() => {
    let alive = true;
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduce(value);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/**
 * The shared machinery: a `progress` value driven 0→1 on open and back on close,
 * a `mounted` latch that outlives `visible` so the close animation is seen, and
 * the scrim that fades on the same value. Returns what both surfaces need to
 * render themselves.
 */
function useOverlay(visible: boolean, onClosed?: () => void) {
  const [mounted, setMounted] = useState(visible);
  // Always from nothing, even for a surface that is mounted already open. A
  // caller that renders its sheet conditionally — `{picking ? <Sheet …/>}` —
  // hands us `visible` true on the very first render, and seeding the value at
  // 1 there meant the sheet appeared already in place with no arrival at all.
  // Starting at 0 costs the always-mounted callers nothing: they mount closed.
  const progress = useRef(new Animated.Value(0)).current;

  // Mount the moment we open — a state adjustment on the visible prop, done in
  // render rather than in the effect (which then only drives the animation and
  // never calls setState synchronously in its body).
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      // `progress` drives the fade for every surface, so it runs at full
      // duration even under reduced motion — a fade is the accessible way to
      // appear, not the motion reduced motion is there to spare. What reduced
      // motion drops is the travel and the scale, and those are gated where they
      // are applied (the sheet's translate, the popup's scale), not here.
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...OPEN_SPRING }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: CLOSE_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, mounted, progress]);

  // Told once the surface is really gone: its exit has played and the Modal
  // holding it has left the screen. Run from an effect, so after the commit that
  // removed it — which is what makes it safe to open the next overlay from here.
  // On iOS a Modal is a presented view controller: open a second one while the
  // first is still closing and it is presented *on* the first, then dismissed
  // along with it, leaving React holding an overlay that is not on the screen
  // and a screen that no longer answers a tap.
  const closed = useRef(onClosed);
  useEffect(() => {
    closed.current = onClosed;
  });
  const wasMounted = useRef(mounted);
  useEffect(() => {
    if (wasMounted.current && !mounted) closed.current?.();
    wasMounted.current = mounted;
  }, [mounted]);

  return { mounted, progress };
}

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** The grab-handle bar at the top — the "you can pull this down" grammar. On
   *  by default; drop it for a sheet that is not dismissible by drag. */
  handle?: boolean;
  /** The card's own comfortable side padding. On by default; turn it off for a
   *  sheet whose content manages its own gutters (a full-bleed list or grid, or
   *  a form that already pads itself). */
  padded?: boolean;
  /** Extra style for the sheet card — a `maxHeight` for a tall sheet, say. */
  style?: ViewStyle;
  /** Screen-reader label for the tap-away scrim. */
  closeLabel?: string;
  /**
   * A heading drawn in the sheet's own header, beside the handle.
   *
   * Worth being the sheet's business rather than the caller's, because the
   * header is also the drag surface: a title passed here is part of what you
   * can pull down, and — like the handle above it — a tap on it closes. A sheet
   * that renders its own title inside `children` gets neither, and the handle
   * alone is a 40×4 target to pull.
   */
  title?: string;
  /**
   * One control on the title's line, at the far end — the sheet's own "and the
   * long way round" escape, which belongs beside the heading rather than under
   * the thing it is an alternative to.
   *
   * It is nested inside the header's close-on-tap surface, which is safe: a
   * press lands on the innermost responder, so the control fires and the sheet
   * does not close behind it. Keep it to one small control; the header is also
   * the drag surface, and a row of them there reads as a toolbar nobody can
   * pull.
   */
  titleAction?: ReactNode;
  /**
   * Called once the sheet has finished closing and left the screen. Open the
   * next overlay from here, not from the tap that closed this one — see
   * `useOverlay`.
   */
  onClosed?: () => void;
}

/**
 * The card itself, rendered *inside* the modal's own safe-area provider so its
 * foot is measured against the window it is actually drawn in.
 *
 * Split out for exactly that reason: `useScreenClearance` has to run under the
 * provider below, and a hook cannot be called halfway down a return tree.
 */
function SheetCard({
  handle,
  padded,
  style,
  title,
  titleAction,
  onClose,
  closeLabel,
  dragHandlers,
  onLayout,
  children,
}: {
  handle: boolean;
  padded: boolean;
  style?: ViewStyle;
  title?: string;
  titleAction?: ReactNode;
  onClose: () => void;
  closeLabel: string;
  /** `PanResponder` props for the header, so the sheet can be pulled down. */
  dragHandlers: Record<string, unknown>;
  onLayout: (height: number) => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  // The same foot every scrolling screen leaves at the bottom edge, from the
  // same helper: the system navigation bar plus a breath, so the last row of a
  // sheet clears the gesture pill or the three buttons the way the last row of
  // a list does. It used to be spelled out here as `spacing.md + insets.bottom`,
  // which was the same arithmetic in a second place — and a second place is
  // where the two drift apart.
  const foot = useScreenClearance(theme.spacing.md);

  return (
    <Pressable
      onPress={() => {}}
      accessibilityViewIsModal
      onLayout={(event) => onLayout(event.nativeEvent.layout.height)}
      style={[
        {
          backgroundColor: theme.color.surface,
          borderTopLeftRadius: theme.radius.xxl,
          borderTopRightRadius: theme.radius.xxl,
          paddingHorizontal: padded ? theme.spacing.lg : 0,
          paddingTop: theme.spacing.md,
          paddingBottom: foot,
          ...theme.shadow.lifted,
        },
        style,
      ]}
    >
      {/* The header: handle, optional title, and the whole drag surface.
          Mounted even for a sheet with neither, because the pan responder has
          to live somewhere — an empty strip is still a few points of card you
          can start a pull from, and it costs nothing when there is no handle.

          Deliberately *not* the whole card: a pan responder over the card
          fights any list inside it, and the loser is whichever one the finger
          actually meant. The header is the part of a sheet that is never
          scrollable, so it is the part that can be dragged. */}
      <View {...dragHandlers}>
        <Pressable
          accessibilityRole={title ? 'button' : undefined}
          accessibilityLabel={title ? closeLabel : undefined}
          // Tap-to-close only where there is a title to press. A bare handle is
          // a 4pt bar; making it dismiss on tap turns a mis-aimed scroll into a
          // closed sheet, which is how you lose a half-filled form.
          onPress={title ? onClose : undefined}
          disabled={!title}
          style={{
            gap: theme.spacing.md,
            marginBottom: handle || title || titleAction ? theme.spacing.sm : 0,
          }}
        >
          {handle ? (
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.color.border,
              }}
            />
          ) : null}
          {title || titleAction ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              {/* The heading takes the room and the action keeps its own width,
                  so a long title truncates rather than pushing the control off
                  the card. */}
              <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>
                {title ?? ''}
              </Text>
              {titleAction}
            </View>
          ) : null}
        </Pressable>
      </View>
      {children}
    </Pressable>
  );
}

/**
 * A bottom sheet: the surface slides up from the bottom edge under a fading
 * scrim, and back down on dismiss. Tapping the scrim closes it; the sheet itself
 * swallows the tap so a press inside never dismisses. Rounded top corners, a
 * grab handle, and the safe-area inset folded into the bottom padding.
 */
/**
 * `style` with a percentage `maxHeight` turned into points of `screenHeight`.
 * Anything else — a number, no ceiling at all — passes through untouched.
 */
export function resolveSheetHeight(
  style: ViewStyle | undefined,
  screenHeight: number,
): ViewStyle | undefined {
  const ceiling = style?.maxHeight;
  if (typeof ceiling !== 'string' || !ceiling.endsWith('%')) return style;
  const share = Number.parseFloat(ceiling) / 100;
  if (!Number.isFinite(share)) return style;
  return { ...style, maxHeight: Math.round(screenHeight * share) };
}

/**
 * How much of the screen the keyboard is currently covering.
 *
 * A `Modal` on Android is its own native window, and `adjustResize` — which the
 * app sets for its main window — does not reach it. So the keyboard opens
 * *over* a bottom-anchored sheet and hides the field being typed into along
 * with both of its buttons. (iOS does not resize a modal either; it just tends
 * to hurt less, because sheets there are usually shorter.)
 *
 * `will` events on iOS so the lift runs with the keyboard rather than after it;
 * Android only emits the `did` pair, and emits them early enough to look right.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) =>
      setInset(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setInset(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return inset;
}

/**
 * Pull the header down to dismiss.
 *
 * `PanResponder` rather than a gesture library, for the reason at the top of
 * this file: the design system carries no animation or gesture dependency, and
 * this is a single-finger vertical drag — the thing RN's own responder system
 * was written for.
 *
 * The travel is added to the entrance translate rather than replacing it, so a
 * sheet caught mid-arrival and dragged does not jump: the two offsets simply
 * sum. Downward follows the finger exactly; upward rubber-bands at a quarter,
 * which is what makes the sheet feel anchored to the bottom edge instead of
 * loose.
 */
function useSheetDrag(visible: boolean, onClose: () => void) {
  const drag = useRef(new Animated.Value(0)).current;
  // The live handler, so the responder (built once) never closes over a stale
  // `onClose` from the render that created it.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    // A sheet reopened after being flung away must start where sheets start.
    if (visible) drag.setValue(0);
  }, [visible, drag]);

  const responder = useRef(
    PanResponder.create({
      // Not on *start*: a tap on the header is the close button, and claiming
      // the touch here would swallow it. Only a deliberate vertical move —
      // past a few points, and more vertical than horizontal — becomes a drag.
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => {
        drag.setValue(gesture.dy > 0 ? gesture.dy : gesture.dy / 4);
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > DRAG_CLOSE_DISTANCE || gesture.vy > DRAG_CLOSE_VELOCITY) {
          // Let go of it: the overlay's own exit runs from wherever the finger
          // left the card, so the sheet carries on down rather than snapping
          // back first and then leaving.
          close.current();
          return;
        }
        Animated.spring(drag, {
          toValue: 0,
          useNativeDriver: true,
          damping: 20,
          stiffness: 220,
          mass: 0.8,
        }).start();
      },
      // An interrupted drag (a call arriving, say) is a drag that did not
      // happen, not a dismissal.
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true, ...OPEN_SPRING }).start();
      },
    }),
  ).current;

  return { drag, handlers: responder.panHandlers as unknown as Record<string, unknown> };
}

export function Sheet({
  visible,
  onClose,
  children,
  handle = true,
  padded = true,
  style,
  closeLabel = 'Close',
  title,
  titleAction,
  onClosed,
}: SheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { mounted, progress } = useOverlay(visible, onClosed);
  const keyboard = useKeyboardInset();
  const { drag, handlers } = useSheetDrag(visible, onClose);
  // The sheet's own height, measured on layout, so it travels exactly its own
  // distance rather than a guess. Until the first measure a screen-height
  // fallback keeps the first frame off-screen instead of flashing in place.
  const [height, setHeight] = useState(0);

  if (!mounted) return null;

  // A percentage ceiling means a share of the *screen*. Handed to the card as
  // is, it resolved against the card's own wrapper instead — whose height is
  // the card's natural height — so every sheet came out at 75% (or 88%, 90%…)
  // of itself: the last rows clipped, and the missing quarter left as a band
  // of scrim under a card that no longer reached the bottom edge.
  const cardStyle = resolveSheetHeight(style, screenHeight);

  // Reduced motion drops the entrance travel, not the drag: a sheet you are
  // holding should follow your finger whatever the OS says about animation.
  const entrance = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [reduceMotion ? 0 : height || screenHeight, 0],
  });
  const translateY = Animated.add(entrance, drag);

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      transparent
      statusBarTranslucent
      // A sheet is anchored to the bottom edge, so the *bottom* edge is the one
      // that has to be its own. Without this the modal gets a window that stops
      // above the navigation bar: the card's rounded top corners are then drawn
      // over a surface that ends short of the screen, and the safe-area foot
      // below the last row is reserved twice — once by the window, once by the
      // padding. `statusBarTranslucent` has always said this about the top; this
      // is the same sentence for the other end.
      navigationBarTranslucent
      visible={mounted}
      animationType="none"
      onRequestClose={onClose}
    >
      {/* A modal is its own native window, and the app's root provider never
          measures it: the insets read through the context belong to the screen
          underneath, which is a different window with different bars. Giving the
          modal its own provider makes the safe area re-measure against the
          window the sheet is actually drawn in — the same cure `Screen`'s
          `inModal` applies, and the reason that prop exists.

          Seeded with the app's insets rather than left to measure from nothing:
          a bare provider renders null until its first layout lands, which would
          hold the sheet off the screen for a frame while the entrance animation
          was already running — the sheet would appear halfway up its own travel.
          The seed is a good guess for one frame; the real measurement replaces
          it immediately. */}
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: screenWidth, height: screenHeight },
          insets,
        }}
      >
        <View style={{ flex: 1 }}>
          {/* Only the scrim fades. The card used to sit inside this fading
              layer, so it came in and went out half see-through, with the
              screen beneath showing through its rows — a white wash across the
              page on every open and close. The card now slides in opaque. */}
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM, opacity: progress }]}
          >
            {/* Underneath, not around: see the note at the top of this file. */}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <View
            pointerEvents="box-none"
            style={{
              flex: 1,
              justifyContent: 'flex-end',
              // Lift the card clear of the keyboard. The card already reserves
              // the navigation bar at its foot, and the keyboard covers that
              // bar — so padding by the raw keyboard height would leave a strip
              // of scrim the width of the nav bar under the card. Subtracting
              // what is already reserved lands the card exactly on the keyboard.
              paddingBottom: keyboard > 0 ? Math.max(keyboard - insets.bottom, 0) : 0,
            }}
          >
            {/* Reduced motion drops the slide, so the card fades instead — the
                only arrival it has left. */}
            <Animated.View
              style={{ transform: [{ translateY }], opacity: reduceMotion ? progress : 1 }}
            >
              <SheetCard
                handle={handle}
                padded={padded}
                style={cardStyle}
                title={title}
                titleAction={titleAction}
                onClose={onClose}
                closeLabel={closeLabel}
                dragHandlers={handlers}
                onLayout={setHeight}
              >
                {children}
              </SheetCard>
            </Animated.View>
          </View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

export interface PopupProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Whether a scrim tap dismisses. Off for a dialog that must be answered. */
  dismissable?: boolean;
  /** Extra style for the dialog card. */
  style?: ViewStyle;
  closeLabel?: string;
}

/**
 * A centred dialog: fades in while scaling up from just under full size, the
 * WhatsApp/Material dialog arrival, and reverses on close. The card sits in the
 * middle over a fading scrim with a comfortable gutter, so a long dialog scrolls
 * inside its own bounds rather than bleeding to the screen edges.
 */
export function Popup({
  visible,
  onClose,
  children,
  dismissable = true,
  style,
  closeLabel = 'Close',
}: PopupProps) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const { mounted, progress } = useOverlay(visible);
  // A dialog with a field in it is the common case, and a modal window on
  // Android never resizes for the keyboard — so the centring box gives up the
  // keyboard's height and the card centres in what is left, rather than staying
  // in the middle of a screen whose bottom half is covered.
  const keyboard = useKeyboardInset();

  if (!mounted) return null;

  const scale = reduceMotion
    ? 1
    : progress.interpolate({ inputRange: [0, 1], outputRange: [POPUP_START_SCALE, 1] });

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      transparent
      statusBarTranslucent
      visible={mounted}
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View style={{ flex: 1, backgroundColor: SCRIM, opacity: progress }}>
        {/* Underneath, not around: see the note at the top of this file. */}
        {dismissable ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View
          pointerEvents="box-none"
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.spacing.xl,
            paddingBottom: theme.spacing.xl + keyboard,
          }}
        >
          <Animated.View
            style={{ width: '100%', opacity: progress, transform: [{ scale }] }}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={() => {}}
              accessibilityViewIsModal
              style={[
                {
                  alignSelf: 'center',
                  maxWidth: 420,
                  width: '100%',
                  backgroundColor: theme.color.surface,
                  borderRadius: theme.radius.xxl,
                  padding: theme.spacing.xl,
                  ...theme.shadow.lifted,
                },
                style,
              ]}
            >
              {children}
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}
