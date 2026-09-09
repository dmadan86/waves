import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import {
  Button,
  Callout,
  Card,
  ChipRow,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { submitFeedback, type FeedbackRating } from '@/data/api';
import { plural, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { useReducedMotion } from '@/lib/reducedMotion';

enum Kind {
  General = 'general',
  Bug = 'bug',
  Idea = 'idea',
}

export default function FeedbackScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();

  const [kind, setKind] = useState<Kind>(Kind.General);
  // 1–5, or null when they write without rating. The table and RPC have always
  // had the column (waves_submit_feedback's p_rating); this is the screen that
  // finally offers it. Tapping a chosen star again clears it — a rating is a
  // gift, not a required field.
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await submitFeedback({
        message: message.trim(),
        kind,
        rating,
        // Version and platform go along because "it crashes" is a different
        // report on an old build than on the current one, and asking somebody
        // to find their build number is asking them not to bother.
        appVersion: Constants.expoConfig?.version ?? null,
        platform: Platform.OS,
      });
      setSent(true);
    } catch (caught) {
      // Never the raw message. On an emulator this screen once showed somebody
      // "Could not find the function public.waves_submit_feedback(...) in the
      // schema cache" while they were mid-complaint.
      setError(friendlyError(caught, t.privacy.couldNotSave, 'feedback.submit'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.privacy.feedbackTitle}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      {sent ? (
        <Sent
          onDone={() => router.back()}
          onAnother={() => {
            // Back to an empty form, not the one they just sent: a second
            // thought is a new message, and the kind it belongs to is theirs to
            // choose again. The rating is the one thing that would be a lie
            // twice over, so it goes too.
            setSent(false);
            setMessage('');
            setRating(null);
            setKind(Kind.General);
          }}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: clearance,
            paddingTop: theme.spacing.lg,
            gap: theme.spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <>
            <Text variant="body" tone="muted">
              {t.privacy.feedbackHint}
            </Text>

            {/* A rating, offered not demanded — the star row a person reaches for
                first, and the one signal that turns a wall of messages into a
                trend. Optional: the label says so, and a second tap clears it. */}
            <Card style={{ gap: theme.spacing.md }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text variant="subheading">{t.privacy.feedbackRating}</Text>
                <Text variant="micro" tone="faint">
                  {t.privacy.feedbackRatingHint}
                </Text>
              </Row>
              <Row style={{ gap: theme.spacing.sm, justifyContent: 'center' }}>
                {([1, 2, 3, 4, 5] as const).map((n) => {
                  const filled = rating !== null && n <= rating;
                  // `filled` drives the drawing (every star up to the choice is
                  // solid); `selected` names the one exact star this control
                  // stands for, so a screen reader announces the rating, not the
                  // fill. The clear-on-second-tap hint rides only that star.
                  const isChoice = n === rating;
                  return (
                    <Pressable
                      key={n}
                      accessibilityRole="button"
                      accessibilityLabel={plural(locale, n, t.privacy.feedbackStarLabel)}
                      accessibilityState={{ selected: isChoice }}
                      accessibilityHint={isChoice ? t.privacy.feedbackStarClearHint : undefined}
                      disabled={busy}
                      hitSlop={6}
                      onPress={() => setRating((current) => (current === n ? null : n))}
                      style={({ pressed }) => ({
                        opacity: pressed ? 0.6 : 1,
                        padding: theme.spacing.xs,
                      })}
                    >
                      <Ionicons
                        name={filled ? 'star' : 'star-outline'}
                        size={iconSize.xl}
                        color={filled ? theme.color.brand : theme.color.textFaint}
                      />
                    </Pressable>
                  );
                })}
              </Row>
            </Card>

            <ChipRow<Kind>
              value={kind}
              onChange={(next) => {
                if (!busy) setKind(next);
              }}
              options={[
                { value: Kind.General, label: t.privacy.kindGeneral },
                { value: Kind.Bug, label: t.privacy.kindBug },
                { value: Kind.Idea, label: t.privacy.kindIdea },
              ]}
            />

            <Card style={{ gap: theme.spacing.xs }}>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={t.privacy.feedbackPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.privacy.feedbackTitle}
                editable={!busy}
                multiline
                autoFocus
                maxLength={4000}
                style={{
                  minHeight: 140,
                  fontSize: 16,
                  color: theme.color.text,
                  textAlignVertical: 'top',
                }}
              />
              {/* The counter appears only once the box is filling up — a "0/4000"
                  on an empty field is a demand for length nobody made. */}
              {message.length > 0 ? (
                <Text variant="micro" tone="faint" align="right">
                  {`${message.length}/4000`}
                </Text>
              ) : null}
            </Card>

            {/* What rides along, said plainly — the alternative is a person
                wondering, or a report we cannot place on a build. */}
            <Text variant="micro" tone="muted">
              {t.privacy.feedbackAttachNote}
            </Text>

            {error ? <Callout tone="negative">{error}</Callout> : null}
            {busy ? <ActivityIndicator color={theme.color.brand} /> : null}

            <Button
              label={t.privacy.feedbackSend}
              size="lg"
              fullWidth
              disabled={busy || message.trim().length === 0}
              onPress={() => void send()}
            />
          </>
        </ScrollView>
      )}
    </Screen>
  );
}

/**
 * What "sent" looks like.
 *
 * It used to be a small card at the top of an otherwise empty screen — the form
 * vanished and left a notice stranded above a whole page of nothing, which
 * reads less like an acknowledgement than like the screen half-loaded. A
 * confirmation is the only thing on the screen at that moment, so it should
 * occupy it: centred, one clear mark, and the two things a person might want
 * next.
 *
 * The mark is `brand`, not `positive`. `positive` is the money colour — in dark
 * mode it is the blue that means "you are owed" — and a tick borrowing it on a
 * screen with no money in it says something it does not mean.
 */
function Sent({ onDone, onAnother }: { onDone: () => void; onAnother: () => void }) {
  const theme = useTheme();
  const { t } = useStrings();
  const reduceMotion = useReducedMotion();

  // A single entrance, and only a small one: the tick settles in rather than
  // simply appearing, which is what makes it read as a reply to the tap. Under
  // reduced motion it is already in place on the first frame.
  const [enter] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    if (reduceMotion) return;
    Animated.spring(enter, {
      toValue: 1,
      damping: 14,
      stiffness: 170,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [enter, reduceMotion]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.xl,
        gap: theme.spacing.xl,
      }}
    >
      <Animated.View
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
          opacity: enter,
          transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
        }}
      >
        <Ionicons name="checkmark" size={iconSize.hero} color={theme.color.brand} />
      </Animated.View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="title" align="center">
          {t.privacy.feedbackThanks}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {t.privacy.feedbackThanksBody}
        </Text>
      </View>

      {/* Done first: most people are finished. "Send another" is there because
          the thought that arrives right after sending used to cost a trip back
          out through settings. */}
      <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm }}>
        <Button label={t.common.done} size="lg" fullWidth onPress={onDone} />
        <Button
          label={t.privacy.feedbackAnother}
          variant="ghost"
          size="lg"
          fullWidth
          onPress={onAnother}
        />
      </View>
    </View>
  );
}
