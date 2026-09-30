/**
 * The daily tip, as a bottom sheet — one useful, Waves-specific move at a time.
 *
 * It shows itself once on the first Home open of each day, opening on the
 * day's tip; the rest of the live deck is a swipe away, with dots to say so. A
 * picture leads: a soft blob holding a small card with the tip's glyph, the
 * "TIP" pill, the title and the body, then the one way out — "Got it →", or
 * "Show me →" for a tip that leads somewhere (only the receipt scan does
 * today). A round close at the corner and a tap on the backdrop dismiss it
 * too — a hint never traps.
 *
 * The show is stamped for the day the moment it opens, not on close, so a
 * person who reads it and backgrounds the app is not shown it again on the
 * next open.
 */

import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View, type NativeScrollEvent } from 'react-native';

import { Gradient, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { usePromptSlot } from '@/lib/promptQueue';
import { useDashboardTips, type Tip } from '@/lib/tips';

/** The day the tip sheet was last shown, so it surfaces once a day and no more. */
const TIP_SHEET_KEY = 'dashboardTips:shownOn';

/**
 * How long the tip waits once it is cleared to show. On a first run this is the
 * beat after the tour finishes before the hint lands; on any other day it is a
 * small settle so the tip does not race the dashboard in. See `usePromptSlot`.
 */
const TIP_DELAY_MS = 1400;

/** Today as `YYYY-MM-DD` in the device's own zone — the unit a daily show counts in. */
function localToday(): string {
  try {
    return new Intl.DateTimeFormat('en-CA').format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function TipSheet() {
  const theme = useTheme();
  const { t } = useStrings();
  const { tips } = useDashboardTips(t);

  // The day the sheet was last shown, read once on mount. `ready` gates the
  // first paint so the sheet never flashes before we know.
  const [shownOn, setShownOn] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(false);
  // Which tip the pager is on; the deck opens on today's.
  const [page, setPage] = useState(0);
  // The pager's width, measured, so each tip is exactly one page wide.
  const [pageWidth, setPageWidth] = useState(0);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(TIP_SHEET_KEY)
      .then((value) => {
        if (alive) setShownOn(value);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Wants to show, on the merits: read, unshown today, not closed, has a deck.
  const wants = ready && shownOn !== localToday() && !closed && tips.length > 0;
  // But it only actually opens once the prompt queue clears it — behind the
  // tour on a first run, and after a short delay either way.
  const granted = usePromptSlot({
    id: 'dashboardTip',
    priority: 10,
    active: wants,
    delayMs: TIP_DELAY_MS,
  });
  const open = wants && granted;

  const stamped = useRef(false);
  useEffect(() => {
    if (!open || stamped.current) return;
    stamped.current = true;
    void AsyncStorage.setItem(TIP_SHEET_KEY, localToday()).catch(() => {});
  }, [open]);

  const close = () => setClosed(true);
  const tip: Tip | undefined = tips[Math.min(page, tips.length - 1)];
  const act = () => {
    if (tip?.route) {
      // The scan tip's route carries a constant `scan=` sentinel; swap it for a
      // fresh nonce so the capture screen fires the camera exactly once and does
      // not reopen it when Android recreates the screen on the camera's return.
      const href = tip.route.includes('scan=') ? `/capture?scan=${Date.now()}` : tip.route;
      router.push(href as never);
    }
    close();
  };
  const onPage = ({ contentOffset }: NativeScrollEvent) => {
    if (pageWidth > 0) setPage(Math.round(contentOffset.x / pageWidth));
  };

  // Presented through the shared Sheet, which mounts fresh with visible=true
  // (never the mount-false-then-toggle that failed to present on Android).
  return (
    <Sheet
      visible={open}
      onClose={close}
      closeLabel={t.common.close}
      style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}
    >
      {tips.length > 0 ? (
        <View style={{ gap: theme.spacing.lg }}>
          {/* The pager, with the close riding its top corner. */}
          <View onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}>
            {pageWidth > 0 ? (
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(event) => onPage(event.nativeEvent)}
              >
                {tips.map((entry) => (
                  <TipPage key={entry.id} tip={entry} width={pageWidth} label={t.tips.label} />
                ))}
              </ScrollView>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.common.close}
              onPress={close}
              hitSlop={8}
              style={({ pressed }) => ({
                position: 'absolute',
                top: 0,
                end: 0,
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.surfaceMuted,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="close" size={iconSize.md} color={theme.color.text} />
            </Pressable>
          </View>

          {/* Dots: one per tip, the live one in the brand. Only when there is
              more than one to swipe to. */}
          {tips.length > 1 ? (
            <Row style={{ justifyContent: 'center', gap: theme.spacing.sm }}>
              {tips.map((entry, index) => (
                <View
                  key={entry.id}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: index === page ? theme.color.brand : theme.color.brandSoft,
                  }}
                />
              ))}
            </Row>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tip?.route ? t.tips.action : t.misc.gotIt}
            onPress={tip?.route ? act : close}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            <Gradient
              colors={theme.gradient.brand}
              radius={theme.radius.pill}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: theme.spacing.sm,
                minHeight: 56,
              }}
            >
              <Text variant="subheading" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
                {tip?.route ? t.tips.action : t.misc.gotIt}
              </Text>
              <Ionicons name="arrow-forward" size={iconSize.lg} color={theme.color.onBrand} />
            </Gradient>
          </Pressable>
        </View>
      ) : null}
    </Sheet>
  );
}

/** One tip: the picture, the TIP pill, the title and the body, centred. */
function TipPage({ tip, width, label }: { tip: Tip; width: number; label: string }) {
  const theme = useTheme();
  return (
    <View style={{ width, alignItems: 'center', gap: theme.spacing.md }}>
      <TipArt icon={tip.icon} />
      <View
        style={{
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 4,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Text variant="micro" tone="brand" style={{ letterSpacing: 1.2, fontWeight: '700' }}>
          {label.toUpperCase()}
        </Text>
      </View>
      <Text
        align="center"
        style={{ fontSize: 28, lineHeight: 34, fontWeight: '800', color: theme.color.text }}
      >
        {tip.title}
      </Text>
      <Text
        variant="body"
        tone="muted"
        align="center"
        style={{ paddingHorizontal: theme.spacing.lg, lineHeight: 24 }}
      >
        {tip.body}
      </Text>
    </View>
  );
}

/**
 * The tip's picture, drawn from views: a soft lilac blob, a small white card
 * tilted a touch with the tip's glyph on a brand disc, and three brand strokes
 * bursting off its corner. Decoration only, so it is hidden from screen readers.
 */
function TipArt({ icon }: { icon: Tip['icon'] }) {
  const theme = useTheme();
  const brand = theme.color.brand;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 240, height: 200, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          position: 'absolute',
          width: 230,
          height: 170,
          borderTopLeftRadius: 110,
          borderTopRightRadius: 70,
          borderBottomLeftRadius: 80,
          borderBottomRightRadius: 120,
          backgroundColor: theme.color.brandSoft,
          opacity: theme.scheme === 'dark' ? 0.5 : 0.65,
        }}
      />
      <View
        style={{
          width: 116,
          height: 116,
          borderRadius: 24,
          backgroundColor: theme.color.surface,
          borderWidth: 1,
          borderColor: theme.color.border,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: '-6deg' }],
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.14,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          elevation: 5,
        }}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: brand,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={34} color={theme.color.onBrand} />
        </View>
      </View>
      {[-28, 0, 28].map((angle, index) => (
        <View
          key={angle}
          style={{
            position: 'absolute',
            top: 22 + index * 6,
            end: 34 - index * 12,
            width: 4,
            height: 22,
            borderRadius: 2,
            backgroundColor: brand,
            transform: [{ rotate: `${angle}deg` }],
          }}
        />
      ))}
    </View>
  );
}
