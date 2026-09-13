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
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import {
  Button,
  Callout,
  Card,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { useStrings, type UiStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { useSmsInboxReader } from '@/lib/smsFeature';
import { offerReadMessages } from '@/lib/smsReadBridge';
import { readSms, SmsReadFailure } from '@/lib/smsReader';

/** How far back a read reaches. A month, unless a person narrows it. */
const WINDOWS = [7, 30] as const;
const DEFAULT_DAYS = 30;

const today = (): string => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Why the inbox could not be read, said in a way a person can act on. */
function readFailureMessage(reason: SmsReadFailure, t: UiStrings): string {
  switch (reason) {
    case SmsReadFailure.Denied:
      return t.smsImport.permissionDenied;
    case SmsReadFailure.Blocked:
      return t.smsImport.permissionBlocked;
    case SmsReadFailure.Unsupported:
      return t.smsImport.readUnsupported;
    case SmsReadFailure.Unavailable:
      return t.smsImport.readUnavailable;
    case SmsReadFailure.Failed:
      return t.smsImport.readFailed;
  }
}

/** One promise, with a glyph: what is read, where it happens, what is kept. */
function Bullet({
  icon,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  children: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Row style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: theme.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
      </View>
      <Text variant="caption" tone="muted" style={{ flex: 1, marginTop: 6 }}>
        {children}
      </Text>
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

  const allow = useCallback(async (): Promise<void> => {
    if (reading) return;
    setReading(true);
    setError(null);
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
  }, [days, reading, t]);

  if (!offered) return null;

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Row style={{ paddingTop: theme.spacing.md, alignItems: 'center' }}>
          <IconButton label={t.common.close} onPress={() => router.back()}>
            <Ionicons name="close" size={iconSize.xl} color={theme.color.text} />
          </IconButton>
        </Row>

        {/* The illustration: one large mark rather than an image asset, which
            would need four locales' worth of nothing and a dark variant. */}
        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: theme.radius.xl,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="chatbubbles-outline" size={44} color={theme.color.brand} />
          </View>
          <Text variant="title" align="center">
            {t.smsImport.disclosure.title}
          </Text>
          <Text variant="caption" tone="muted" align="center">
            {t.smsImport.disclosure.intro}
          </Text>
        </View>

        <Card style={{ gap: theme.spacing.lg }}>
          <Bullet icon="search-outline">{t.smsImport.disclosure.readsWhat}</Bullet>
          <Bullet icon="phone-portrait-outline">{t.smsImport.disclosure.staysHere}</Bullet>
          <Bullet icon="lock-closed-outline">{t.smsImport.disclosure.neverSent}</Bullet>
        </Card>

        {/* How far back. A month by default: far enough to be worth doing, near
            enough that the answer is about this month's spending. */}
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="micro" tone="muted" style={{ textTransform: 'uppercase' }}>
            {t.smsImport.datesSection}
          </Text>
          <Row style={{ gap: theme.spacing.sm }}>
            {WINDOWS.map((window) => (
              <Button
                key={window}
                label={window === 7 ? t.smsImport.last7 : t.smsImport.last30}
                variant={days === window ? 'primary' : 'secondary'}
                size="sm"
                onPress={() => setDays(window)}
              />
            ))}
          </Row>
          <Text variant="micro" tone="muted">
            {t.smsImport.readWindowNote}
          </Text>
        </View>

        {/* Names the dialog that comes next, so the system prompt is a thing
            they were told about rather than a thing that happened to them. */}
        <Callout tone="info">{t.smsImport.disclosure.nextScreen}</Callout>

        {error ? <Callout tone="negative">{error}</Callout> : null}

        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={reading ? t.smsImport.reading : t.smsImport.permissionRationale.allow}
            onPress={() => void allow()}
            disabled={reading}
          />
          {/* Quiet, and it really does nothing: no permission is asked for, and
              pasting is still the whole feature on the screen behind this. */}
          <Button
            label={t.smsImport.permissionRationale.notNow}
            variant="ghost"
            onPress={() => router.back()}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
