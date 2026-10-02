/**
 * The prominent disclosure, before Android is ever asked.
 *
 * Google Play requires that a sensitive permission be explained *in the app's
 * own words*, in a screen a person has to pass, before the system dialog is
 * raised. A `rationale` string attached to `PermissionsAndroid.request` is not
 * that — it is the system's dialog with a sentence in it, shown at the moment
 * the choice is already being demanded. So this screen exists, it says what is
 * read and what becomes of it, it names what the *next* dialog will ask, and
 * "Not now" leaves with nothing having happened.
 *
 * IT IS NOT NORMALLY REACHABLE. `useSmsInboxReader` is asked again here rather
 * than trusted from the screen that pushed: a deep link, a stale back stack, or
 * the flag being switched off while this was open must all end the same way,
 * and the one thing that must never happen is a system permission prompt on a
 * build or a phone that was not meant to see one. With the gates shut, this
 * renders nothing and pops.
 *
 * WHAT IT DOES WITH WHAT IT READS. Hands it to the paste screen through
 * `smsReadBridge` — an in-memory, read-once handoff — and pops. Nothing is
 * written to disk here, nothing goes into a route param, and a draft made from
 * a read message carries no message body at all (`lib/smsDrafts.ts`).
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Callout, Gradient, IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { useSmsInboxReader } from '@/lib/smsFeature';
import { offerReadMessages, requestScanOnReturn } from '@/lib/smsReadBridge';
import { readFailureMessage } from '@/lib/smsFailureMessage';
import { PermissionOutcome, readSms, requestSmsPermission, SmsReadFailure } from '@/lib/smsReader';

/** How far back a read reaches. A month, unless a person narrows it. */
const WINDOWS = [7, 30] as const;
const DEFAULT_DAYS = 30;

const today = (): string => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** A title with its `[bracketed]` part drawn in the brand colour. */
function AccentTitle({ text }: { text: string }): React.JSX.Element {
  const theme = useTheme();
  const parts = text.split(/\[(.+?)\]/);
  return (
    <Text style={{ fontSize: 26, lineHeight: 31, fontWeight: '800', color: theme.color.text }}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Text key={index} style={{ fontSize: 26, fontWeight: '800', color: theme.color.brand }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/**
 * The picture: a bank message on a phone becoming a Waves draft. Drawn from
 * views, so it takes the theme in dark mode and needs no image per locale. The
 * message itself is sample text — bank messages arrive in English.
 */
function ReadIllustration({ draftLabel }: { draftLabel: string }): React.JSX.Element {
  const theme = useTheme();
  const card = {
    position: 'absolute' as const,
    backgroundColor: theme.color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...theme.shadow.lifted,
  };
  return (
    <View
      style={{ width: 150, height: 172 }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {/* the phone */}
      <View
        style={{
          position: 'absolute',
          right: 6,
          top: 0,
          width: 104,
          height: 172,
          borderRadius: 22,
          borderWidth: 3,
          borderColor: theme.color.brand,
          backgroundColor: theme.color.surfaceMuted,
          transform: [{ rotate: '5deg' }],
          padding: 10,
          gap: 6,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 34,
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.color.brand,
            opacity: 0.6,
          }}
        />
        {[70, 50, 62].map((width, index) => (
          <View
            key={index}
            style={{
              width: `${width}%`,
              height: 5,
              borderRadius: 3,
              backgroundColor: theme.color.brandSoft,
            }}
          />
        ))}
      </View>

      {/* the bank message */}
      <View
        style={[
          card,
          { left: 0, top: 30, width: 136, padding: 7, transform: [{ rotate: '-3deg' }] },
        ]}
      >
        <Row style={{ gap: 6, alignItems: 'center' }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.negativeSoft,
            }}
          >
            <Ionicons name="business" size={12} color={theme.color.negative} />
          </View>
          <View style={{ flex: 1 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 9.5, fontWeight: '700', color: theme.color.text }}>
                AXIS Bank
              </Text>
              <Text style={{ fontSize: 8, color: theme.color.textMuted }}>10:24</Text>
            </Row>
            <Text style={{ fontSize: 8.5, color: theme.color.text }} numberOfLines={2}>
              Paid ₹2,450 at Zomato on 12 Sep
            </Text>
          </View>
        </Row>
      </View>

      {/* the arrow between them */}
      <Svg width={34} height={40} style={{ position: 'absolute', right: 6, top: 70 }}>
        <Path
          d="M6 4 C 26 8, 30 22, 22 34"
          stroke={theme.color.brand}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M15 30 L22 35 L27 27"
          stroke={theme.color.brand}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>

      {/* the draft it becomes */}
      <View style={[card, { right: 0, top: 104, width: 108, padding: 8, gap: 3 }]}>
        <Text
          style={{ fontSize: 9, fontWeight: '700', color: theme.color.brand }}
          numberOfLines={1}
        >
          {draftLabel}
        </Text>
        <Row style={{ gap: 6, alignItems: 'center' }}>
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="restaurant" size={12} color={theme.color.brand} />
          </View>
          <View>
            <Text style={{ fontSize: 9, color: theme.color.textMuted }}>Zomato</Text>
            <Text style={{ fontSize: 14, fontWeight: '800', color: theme.color.text }}>₹2,450</Text>
          </View>
        </Row>
      </View>
    </View>
  );
}

/** One promise: a glyph in a soft circle, a bold line, and what it means. */
function Pledge({
  icon,
  title,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.surfaceMuted,
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: theme.color.text }}>{title}</Text>
        <Text variant="caption" tone="muted">
          {children}
        </Text>
      </View>
    </Row>
  );
}

export default function ReadMessagesScreen(): React.JSX.Element | null {
  const theme = useTheme();
  const clearance = useBottomClearance(theme.spacing.xl);
  const { t } = useStrings();
  const offered = useSmsInboxReader();

  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both gates, re-checked here. Leaving is the only safe answer, and it is
  // done in an effect rather than during render so the router is not navigated
  // mid-commit.
  useEffect(() => {
    if (!offered) router.back();
  }, [offered]);

  // Opened from Bank messages' Scan: this screen only has to get the
  // permission. Bank messages scans the moment it is back in front, so the
  // person taps Continue once and watches the scan — no window to choose here.
  const { then } = useLocalSearchParams<{ then?: string }>();
  const forScan = then === 'scan';

  const allow = useCallback(async (): Promise<void> => {
    if (reading) return;
    setReading(true);
    setError(null);
    if (forScan) {
      const outcome = await requestSmsPermission(t.smsImport.permissionRationale);
      setReading(false);
      if (outcome === PermissionOutcome.Granted) {
        requestScanOnReturn();
        router.back();
      } else {
        setError(
          readFailureMessage(
            outcome === PermissionOutcome.Blocked ? SmsReadFailure.Blocked : SmsReadFailure.Denied,
            t,
          ),
        );
      }
      return;
    }
    try {
      // The system dialog is raised inside here — after this screen, never
      // instead of it. `permissionRationale` is what Android then shows.
      const result = await readSms(
        { from: daysAgo(days), to: today() },
        t.smsImport.permissionRationale,
      );
      if (!result.ok) {
        setError(readFailureMessage(result.reason, t));
        return;
      }
      if (result.messages.length === 0) {
        setError(t.smsImport.readNothing);
        return;
      }
      offerReadMessages(result.messages);
      router.back();
    } catch {
      // `readSms` describes its own failures rather than throwing, so this is
      // the belt on the braces: a native module that throws where it promised
      // a callback must still leave a sentence, not a white screen.
      setError(readFailureMessage(SmsReadFailure.Failed, t));
    } finally {
      setReading(false);
    }
  }, [days, forScan, reading, t]);

  if (!offered) return null;

  const d = t.smsImport.disclosure;

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Row style={{ paddingTop: theme.spacing.sm, alignItems: 'center' }}>
          <IconButton label={t.common.close} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={iconSize.xl} color={theme.color.text} />
          </IconButton>
        </Row>

        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={{ flex: 1, gap: theme.spacing.sm }}>
            <AccentTitle text={d.title} />
            <Text variant="caption" tone="muted">
              {d.intro}
            </Text>
          </View>
          <ReadIllustration draftLabel={d.draftLabel} />
        </Row>

        <View
          style={{
            gap: theme.spacing.lg,
            padding: theme.spacing.lg,
            borderRadius: theme.radius.xl,
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Pledge icon="search-outline" title={d.readsWhatTitle}>
            {d.readsWhat}
          </Pledge>
          <Pledge icon="phone-portrait-outline" title={d.staysHereTitle}>
            {d.staysHere}
          </Pledge>
          <Pledge icon="lock-closed-outline" title={d.neverSentTitle}>
            {d.neverSent}
          </Pledge>
        </View>

        {/* How far back, for the paste flow only. A month by default: far
            enough to be worth doing, near enough that the answer is about this
            month's spending. A scan picks its own window. */}
        {forScan ? null : (
          <View style={{ gap: theme.spacing.sm }}>
            <Text
              variant="micro"
              tone="muted"
              style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
            >
              {d.windowLabel}
            </Text>
            <Row style={{ gap: theme.spacing.sm }}>
              {WINDOWS.map((window) => {
                const selected = days === window;
                return (
                  <Pressable
                    key={window}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setDays(window)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      height: 40,
                      paddingHorizontal: theme.spacing.lg,
                      borderRadius: theme.radius.pill,
                      backgroundColor: selected ? theme.color.brand : theme.color.brandSoft,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    {selected ? (
                      <Ionicons name="checkmark" size={16} color={theme.color.onBrand} />
                    ) : null}
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: '600',
                        color: selected ? theme.color.onBrand : theme.color.brand,
                      }}
                    >
                      {window === 7 ? t.smsImport.last7 : t.smsImport.last30}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
          </View>
        )}

        {error ? <Callout tone="negative">{error}</Callout> : null}

        <View style={{ gap: theme.spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reading ? t.smsImport.reading : d.continue}
            accessibilityState={{ disabled: reading, busy: reading }}
            disabled={reading}
            onPress={() => void allow()}
            style={({ pressed }) => ({ opacity: pressed || reading ? 0.85 : 1 })}
          >
            <Gradient
              colors={theme.gradient.brand}
              radius={theme.radius.pill}
              style={{ height: 52, justifyContent: 'center', paddingHorizontal: theme.spacing.xl }}
            >
              <Row style={{ alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: theme.color.onBrand }}>
                  {reading ? t.smsImport.reading : d.continue}
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={20}
                  color={theme.color.onBrand}
                  style={{ position: 'absolute', end: 0 }}
                />
              </Row>
            </Gradient>
          </Pressable>
          {/* One line for both: only the chosen days are read, and Android asks
              next — so the system prompt is a thing they were told about. */}
          <Text variant="micro" tone="muted" align="center">
            {forScan ? d.nextScreenScan : d.nextScreen}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
