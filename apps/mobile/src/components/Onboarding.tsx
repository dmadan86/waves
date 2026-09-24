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
 * Full-bleed tint per card rather than one background: the colour changing
 * under your thumb is the progress indicator that needs no explanation, and the
 * dots are there for anyone who wants to count.
 */

import { memo, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Animated, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, iconSize, isRtlLayout, Text, type TintName, useTheme } from '@waves/ui';

import { TourPager, type TourPagerHandle } from '@/components/TourPager';
import { useStrings } from '@/i18n';

interface Slide {
  readonly tint: TintName;
  readonly emoji: string;
}

/**
 * Emoji rather than illustration. Not for want of an artist: art has to ship as
 * a binary asset in every build, and this screen is the one that renders before
 * the app has proved anything about itself. The group covers are emoji for the
 * same reason, so the tour looks like the product rather than like a brochure
 * bolted to the front of it.
 */
const SLIDES: readonly Slide[] = [
  { tint: 'lilac', emoji: '🧾' },
  { tint: 'mint', emoji: '🔗' },
  { tint: 'peach', emoji: '⚡' },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
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
  // The dots take the ink of the card they sit over, blending between two as
  // the page moves.
  const inks = SLIDES.map((slide) => theme.tint[slide.tint].ink);
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
        const copy = t.onboarding[slideIndex] ?? t.onboarding[0]!;
        return (
          <SlideCard
            key={slide.tint}
            emoji={slide.emoji}
            tint={slide.tint}
            title={copy.title}
            body={copy.body}
            appName={t.common.appName}
            skipLabel={t.skip}
            width={width}
            height={height}
            rtl={rtl}
            topInset={insets.top}
            bottomInset={insets.bottom}
            onSkip={onDone}
          />
        );
      }),
    [rtl, t, width, height, insets.top, insets.bottom, onDone],
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
          height: 56,
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
                key={dot.tint}
                style={{
                  height: 8,
                  width: progress.interpolate({ ...near, outputRange: [8, 24, 8] }),
                  borderRadius: theme.radius.pill,
                  backgroundColor: dotInk,
                  opacity: progress.interpolate({ ...near, outputRange: [0.3, 1, 0.3] }),
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
          style={({ pressed }) => ({
            minHeight: 56,
            flexShrink: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.xl,
            paddingVertical: theme.spacing.sm,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.buttonPrimary,
            opacity: pressed ? 0.85 : 1,
            ...theme.shadow.soft,
          })}
        >
          <Text
            style={{
              fontSize: 17,
              fontWeight: '700',
              color: theme.color.onButtonPrimary,
              flexShrink: 1,
            }}
          >
            {isLast ? t.getStarted : t.next}
          </Text>
          <Ionicons
            // A tick means the same in both directions; an arrow does not, and
            // this one kept pointing right in a mirrored screen — "next"
            // pointing backwards, on the very first screen.
            name={isLast ? 'checkmark' : directionalIcon('arrow-forward')}
            size={iconSize.lg}
            color={theme.color.onButtonPrimary}
          />
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
  emoji,
  tint,
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
  emoji: string;
  tint: TintName;
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
  const { bg, ink, inkMuted } = theme.tint[tint];

  return (
    <View
      style={{
        width,
        // Stated rather than stretched: a horizontal ScrollView sizes itself to
        // its content, so a card left to find its own height is only as tall as
        // its paragraph and the colour stops in the middle of the screen.
        height,
        // The card mirrors even though the pager holding it does not, so the
        // wordmark and skip sit where an Arabic reader expects them.
        direction: rtl ? 'rtl' : 'ltr',
        backgroundColor: bg,
        paddingTop: topInset + theme.spacing.md,
        paddingBottom: bottomInset + theme.spacing.xxl,
        paddingHorizontal: theme.spacing.xxxl,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: ink }}>{appName}</Text>
        {/* Skip carries the card's own ink, the colour the title is in, so it
            reads on every tint — the old brand purple all but vanished on the
            pastel backgrounds. A chevron makes it look like the shortcut it is,
            and it mirrors with the layout. */}
        <Pressable
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel={skipLabel}
          hitSlop={12}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}
        >
          <Text variant="caption" style={{ color: ink, fontWeight: '600' }}>
            {skipLabel}
          </Text>
          <Ionicons name={directionalIcon('chevron-forward')} size={iconSize.sm} color={ink} />
        </Pressable>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {/* Decorative: the sentence below says the same thing, and a screen
            reader announcing "receipt" adds nothing. */}
        <Text accessibilityElementsHidden importantForAccessibility="no" style={{ fontSize: 120 }}>
          {emoji}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <Text style={{ fontSize: 36, fontWeight: '700', color: ink }}>{title}</Text>
        <Text variant="body" style={{ color: inkMuted }}>
          {body}
        </Text>
      </View>

      {/* The room the dots and arrow used to take. They are one overlay now (see
          Onboarding), so the card only reserves their space to keep the
          paragraph at the height it has always sat at. */}
      <View style={{ marginTop: theme.spacing.xxl, height: 56 }} />
    </View>
  );
});
