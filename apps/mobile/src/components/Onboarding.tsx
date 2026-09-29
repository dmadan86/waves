/**
 * The three cards a first-time user meets, before the welcome.
 *
 * A tour is a tax on somebody who wants to split a bill, so it is paid exactly
 * once and it is always skippable from the first frame. What it buys is the
 * three things about Waves that are not guessable from a ledger screen: that
 * nothing is behind a sign-up, that the people you split with do not need the
 * app, and that settling hands the amount to a payment app rather than leaving
 * you to type it. Somebody who never reads this loses nothing they cannot find
 * later.
 *
 * Full-bleed colour per card rather than one background: the colour changing
 * under your thumb is the progress indicator that needs no explanation, and the
 * dots are there for anyone who wants to count. Each card has its own ink, and
 * the dots and the button take it on as the page moves.
 */

import { memo, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Animated, Image, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, iconSize, isRtlLayout, Text, useTheme } from '@waves/ui';

import { TourPager, type TourPagerHandle } from '@/components/TourPager';
import { useStrings } from '@/i18n';

export interface IntroSlide {
  readonly key: string;
  /** The card's field, top to bottom. */
  readonly bg: readonly [string, string];
  /** Title, wordmark, dots and button. */
  readonly ink: string;
  readonly inkMuted: string;
  /** A soft shape behind the picture, a shade off the field. */
  readonly glow: string;
  readonly art: number;
}

/**
 * The cards' own light palette in every theme: this is a front-of-house screen,
 * seen before anything else, and it reads as one piece with the art. Each
 * picture is a transparent still, a few kilobytes, drawn for its card.
 */
const SLIDES: readonly IntroSlide[] = [
  {
    key: 'split',
    bg: ['#FFF5E8', '#FCEBD6'],
    ink: '#3A220F',
    inkMuted: '#8A5B35',
    glow: '#F8DDBC',
    art: require('../../assets/images/onboard-split.webp') as number,
  },
  {
    key: 'link',
    bg: ['#EEEFFF', '#E3E5FD'],
    ink: '#14166B',
    inkMuted: '#4A4E8C',
    glow: '#D8DAFB',
    art: require('../../assets/images/onboard-link.webp') as number,
  },
  {
    key: 'settle',
    bg: ['#EDFAF5', '#DDF3EA'],
    ink: '#0F3A2C',
    inkMuted: '#3F6B5C',
    glow: '#CDEBDF',
    art: require('../../assets/images/onboard-settle.webp') as number,
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useStrings();
  return <IntroCards slides={SLIDES} copy={t.onboarding} skipLabel={t.skip} onDone={onDone} />;
}

/**
 * A run of full-bleed cards with dots and a Next button — the first-run intro,
 * and the Personal tab's. The words come in with the cards; this only knows the
 * look.
 */
export function IntroCards({
  slides: SLIDES,
  copy: COPY,
  skipLabel,
  onDone,
}: {
  slides: readonly IntroSlide[];
  copy: readonly { title: string; body: string }[];
  skipLabel: string;
  onDone: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useStrings();
  const { width, height } = useWindowDimensions();
  const pager = useRef<TourPagerHandle>(null);
  // The card the pager has settled on: it decides the button's label.
  const [index, setIndex] = useState(0);
  // Where the pager is between cards, continuously, so the dots move with the
  // page under the thumb rather than jumping once it lands — or, from the
  // arrow, before it has even moved.
  const [progress] = useState(() => new Animated.Value(0));
  const rtl = isRtlLayout();

  const goTo = (next: number) => {
    if (next >= SLIDES.length) {
      onDone();
      return;
    }
    pager.current?.goTo(next);
  };

  const isLast = index === SLIDES.length - 1;
  // The dots and the button take the ink of the card they sit over, blending
  // between two as the page moves.
  const inks = SLIDES.map((slide) => slide.ink);
  const dotInk =
    SLIDES.length > 1
      ? progress.interpolate({
          inputRange: SLIDES.map((_, slideIndex) => slideIndex),
          outputRange: inks,
          extrapolate: 'clamp',
        })
      : inks[0]!;

  // The three cards, built once and held stable across `index` changes. Without
  // this the `.map` reran on every drag that crossed a page boundary (that is
  // what moves `index`), handing the pager a fresh children array mid-gesture;
  // React then reconciled all three full-screen cards while the finger was still
  // down, and the swipe stuttered. `index` is deliberately not a dependency —
  // only the dots overlay below tracks it, and it lives in its own subtree.
  const cards = useMemo(
    () =>
      SLIDES.map((slide, slideIndex) => {
        // The words live in the string table; this file only knows the look.
        const copy = COPY[slideIndex] ?? COPY[0]!;
        return (
          <SlideCard
            key={slide.key}
            slide={slide}
            title={copy.title}
            body={copy.body}
            appName={t.common.appName}
            skipLabel={skipLabel}
            width={width}
            height={height}
            rtl={rtl}
            topInset={insets.top}
            bottomInset={insets.bottom}
            onSkip={onDone}
          />
        );
      }),
    [SLIDES, COPY, skipLabel, rtl, t, width, height, insets.top, insets.bottom, onDone],
  );

  return (
    <View style={{ flex: 1 }}>
      <TourPager
        ref={pager}
        rtl={rtl}
        onProgress={(slide) => progress.setValue(slide)}
        onSlideChange={setIndex}
      >
        {cards}
      </TourPager>

      {/* The dots and the next arrow are the only things that track which card
          is showing, so they live here as one overlay rather than a copy baked
          into every card. A swipe now recolours a few pixels of dot instead of
          re-rendering three full-screen cards mid-gesture — which is what made
          the tour drag. Placed to land exactly where the in-card row sat; the
          cards reserve its room with a matching spacer. `box-none` so the empty
          gaps still pass the drag through to the pager underneath. */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: theme.spacing.xxxl,
          right: theme.spacing.xxxl,
          bottom: insets.bottom + theme.spacing.xxl,
          height: 46,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          // Mirrors like the card did: dots at the start, arrow at the end.
          direction: rtl ? 'rtl' : 'ltr',
        }}
      >
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {SLIDES.map((dot, dotIndex) => {
            // 1 on this dot's card, falling to 0 a card away either side.
            const near = {
              inputRange: [dotIndex - 1, dotIndex, dotIndex + 1],
              extrapolate: 'clamp' as const,
            };
            return (
              <Animated.View
                key={dot.key}
                style={{
                  height: 8,
                  width: progress.interpolate({ ...near, outputRange: [8, 26, 8] }),
                  borderRadius: theme.radius.pill,
                  backgroundColor: dotInk,
                  opacity: progress.interpolate({ ...near, outputRange: [0.25, 1, 0.25] }),
                }}
              />
            );
          })}
        </View>

        {/* Text leads, glyph trails. A new user should read what the button does
            ("Next", then "Get started") rather than decode an arrow or a tick.
            The pill sizes to its label, so a longer word in another language just
            widens it. It can shrink (`flexShrink`) and grow taller (`minHeight`)
            rather than overflow the dots when a long label meets a large system
            font scale; the label wraps, the icon keeps its size. */}
        <Pressable
          onPress={() => goTo(index + 1)}
          accessibilityRole="button"
          accessibilityLabel={isLast ? t.getStarted : t.next}
          style={({ pressed }) => ({ flexShrink: 1, opacity: pressed ? 0.85 : 1 })}
        >
          <Animated.View
            style={{
              minHeight: 46,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radius.pill,
              backgroundColor: dotInk,
            }}
          >
            <Text
              maxFontSizeMultiplier={1}
              style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF', flexShrink: 1 }}
            >
              {isLast ? t.getStarted : t.next}
            </Text>
            {/* Mirrored with the layout: "next" never points backwards. */}
            <Ionicons name={directionalIcon('arrow-forward')} size={18} color="#FFFFFF" />
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * One card — index-free on purpose, and memoised, so the current-card state
 * changing (which drives the dots) never re-renders the three cards. Only the
 * overlay above tracks the index; a card is a fixed painting the pager slides.
 */
const SlideCard = memo(function SlideCard({
  slide,
  title,
  body,
  appName,
  skipLabel,
  width,
  height,
  rtl,
  topInset,
  bottomInset,
  onSkip,
}: {
  slide: IntroSlide;
  title: string;
  body: string;
  appName: string;
  skipLabel: string;
  width: number;
  height: number;
  rtl: boolean;
  topInset: number;
  bottomInset: number;
  onSkip: () => void;
}) {
  const theme = useTheme();
  const { ink, inkMuted } = slide;
  const artSize = Math.min(width - 80, 270);

  return (
    <View
      // A card is a still painting the pager slides: drawn once into a
      // texture and moved as a bitmap, rather than re-rasterising its gradient
      // and translucent art on every frame of a swipe.
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      style={{
        width,
        // Stated rather than stretched: a horizontal ScrollView sizes itself to
        // its content, so a card left to find its own height is only as tall as
        // its paragraph and the colour stops in the middle of the screen.
        height,
        // The card mirrors even though the pager holding it does not, so the
        // wordmark and skip sit where an Arabic reader expects them.
        direction: rtl ? 'rtl' : 'ltr',
        paddingTop: topInset + theme.spacing.md,
        paddingBottom: bottomInset + theme.spacing.xxl,
        paddingHorizontal: theme.spacing.xxxl,
      }}
    >
      <LinearGradient
        colors={slide.bg}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text maxFontSizeMultiplier={1} style={{ fontSize: 20, fontWeight: '800', color: ink }}>
          {appName}
        </Text>
        {/* Skip carries the card's own ink, so it reads on every card. A
            chevron makes it look like the shortcut it is, and it mirrors with
            the layout. */}
        <Pressable
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel={skipLabel}
          hitSlop={12}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}
        >
          <Text maxFontSizeMultiplier={1} style={{ fontSize: 14, color: ink, fontWeight: '600' }}>
            {skipLabel}
          </Text>
          <Ionicons name={directionalIcon('chevron-forward')} size={iconSize.sm} color={ink} />
        </Pressable>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {/* Decorative: the sentence below says the same thing. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: artSize,
            height: artSize,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              position: 'absolute',
              width: artSize * 0.86,
              height: artSize * 0.86,
              borderRadius: artSize,
              backgroundColor: slide.glow,
              opacity: 0.55,
            }}
          />
          <Image
            source={slide.art}
            // No fade-in: Android fades a picture over 300ms by default, which
            // reads as the art arriving late behind every swipe.
            fadeDuration={0}
            resizeMode="contain"
            style={{ width: artSize, height: artSize * 0.86 }}
          />
        </View>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text
          maxFontSizeMultiplier={1}
          style={{ fontSize: 28, lineHeight: 34, fontWeight: '800', color: ink }}
        >
          {title}
        </Text>
        <Text maxFontSizeMultiplier={1} style={{ fontSize: 15, lineHeight: 22, color: inkMuted }}>
          {body}
        </Text>
      </View>

      {/* The room the dots and arrow take: they are one overlay (see
          Onboarding), so the card only reserves their space. */}
      <View style={{ marginTop: theme.spacing.xl, height: 46 }} />
    </View>
  );
});
