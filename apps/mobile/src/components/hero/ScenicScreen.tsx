/**
 * The scenic screen shell Home wears, shared by every screen that opens on the
 * same hero: a photograph behind a fixed header row, a glass card riding up
 * over its foot, and the body scrolling underneath.
 *
 *   background  the scene (drawn inside the card's blur target)
 *   header      the row's content, drawn twice: white over the photo, then in
 *               theme ink once the page has scrolled (the layers cross-fade)
 *   card        the glass card; handed the blur target for Android
 *   children    the scrolling body, in the padded column under the card
 *
 * The scroll view must stay an `Animated.ScrollView`: the offset drives the
 * fade natively, and a plain ScrollView crashes on scroll.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FlashList } from '@shopify/flash-list';
import { BlurTargetView } from 'expo-blur';
import {
  Animated,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Row, useTabBarClearance, useTheme } from '@waves/ui';

import { useHeroStatusBar } from '@/components/ScenicScreenHero';

/** How far down the card the scene reaches before it has faded into the page. */
const SCENE_INTO_CARD = 0.72;
const HERO_WHITE = '#FFFFFF';

/** The list a `list` screen draws: it must be animated, or the native scroll event cannot reach it. */
export const AnimatedFlashList = Animated.createAnimatedComponent(FlashList) as typeof FlashList;

export function ScenicScreen({
  background,
  header,
  card,
  children,
  refreshControl,
  bodyStyle,
  list,
  compact = false,
  keyboardShouldPersistTaps = 'handled',
}: {
  background: (geometry: {
    height: number;
    photoHeight: number;
    scrimHeight: number;
    pageColor: string;
  }) => ReactNode;
  /** The row's content. `solid` is the scrolled (theme ink) copy. */
  header: (ink: string, solid: boolean) => ReactNode;
  card: (blurTarget: RefObject<View | null>) => ReactNode;
  children?: ReactNode;
  refreshControl?: React.ReactElement<any>;
  bodyStyle?: ViewStyle;
  /**
   * For screens whose body is a virtualised list that cannot sit inside a
   * ScrollView: draw the list yourself, wire `onScroll` to it, and put `top`
   * (the header's room, then the card) at the head of its content. Replaces
   * `children` and the built-in ScrollView.
   */
  list?: (parts: {
    // An `Animated.event`: hand it to `AnimatedFlashList` (never a plain list).
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    top: ReactNode;
    keyboardShouldPersistTaps: 'always' | 'never' | 'handled';
  }) => ReactNode;
  /** No card is drawn (a tab that owns its own scrolling): the header stays solid. */
  compact?: boolean;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const sceneRef = useRef<View>(null);
  const [headerHeight, setHeaderHeight] = useState(insets.top + 56);
  const [greetingHeight, setGreetingHeight] = useState(46);
  const [cardHeight, setCardHeight] = useState(280);
  const sceneHeight = headerHeight + (compact ? 0 : cardHeight * SCENE_INTO_CARD);
  const [scrollY] = useState(() => new Animated.Value(0));
  const [headerOpaque, setHeaderOpaque] = useState(false);
  const fade = (from: number, to: number) =>
    scrollY.interpolate({ inputRange: [0, 24], outputRange: [from, to], extrapolate: 'clamp' });
  const headerOpacity = fade(0, 1);
  const sceneShift = scrollY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -1],
    extrapolateLeft: 'clamp',
  });
  const heroInkOpacity = fade(1, 0);
  const solidInkOpacity = fade(0, 1);
  useEffect(() => {
    const listener = scrollY.addListener(({ value }) => setHeaderOpaque(value >= 24));
    return () => scrollY.removeListener(listener);
  }, [scrollY]);
  useEffect(() => {
    if (list) scrollY.setValue(compact ? 24 : 0);
  }, [list, compact, scrollY]);
  useHeroStatusBar(headerOpaque && theme.scheme !== 'dark' ? 'dark' : 'light');

  const rowStyle = { alignItems: 'center', gap: theme.spacing.md } as const;

  return (
    <View style={{ flex: 1 }}>
      {/* The scene scrolls away with the page: it moves up exactly as far as the
          content does (never down on an overscroll). */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: sceneHeight,
          transform: [{ translateY: sceneShift }],
        }}
      >
        <BlurTargetView
          ref={sceneRef}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: sceneHeight }}
        >
          {background({
            height: sceneHeight,
            photoHeight: Math.min(220, Math.max(180, headerHeight + 20)),
            scrimHeight: insets.top + theme.spacing.sm + greetingHeight,
            pageColor: theme.color.bg,
          })}
        </BlurTargetView>
      </Animated.View>
      {list ? (
        list({
          onScroll: Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          }) as unknown as (event: NativeSyntheticEvent<NativeScrollEvent>) => void,
          top: (
            <>
              <View style={{ height: headerHeight }} />
              {compact ? null : (
                <View style={{ paddingHorizontal: theme.spacing.lg }}>
                  <View onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}>
                    {card(sceneRef)}
                  </View>
                </View>
              )}
            </>
          ),
          keyboardShouldPersistTaps,
        })
      ) : (
        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: clearance }}
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        >
          {/* Room for the fixed header row; the card sits right under it. */}
          <View style={{ height: headerHeight }} />
          <View
            style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.xs, ...bodyStyle }}
          >
            <View onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}>
              {card(sceneRef)}
            </View>
            {children}
          </View>
        </Animated.ScrollView>
      )}
      <View
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1,
          elevation: 4,
          paddingTop: insets.top + theme.spacing.xs,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.xs,
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -insets.top,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.color.bg,
            opacity: headerOpacity,
            borderBottomWidth: 1,
            borderBottomColor: theme.color.border,
          }}
        />
        <View>
          <Animated.View style={{ opacity: heroInkOpacity }}>
            <Row
              onLayout={(event) => setGreetingHeight(event.nativeEvent.layout.height)}
              style={rowStyle}
            >
              {header(HERO_WHITE, false)}
            </Row>
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, opacity: solidInkOpacity }}
          >
            <Row style={rowStyle}>{header(theme.color.text, true)}</Row>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
