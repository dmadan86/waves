/**
 * The ask to add a phone number, after sign-in, until one is linked.
 *
 * Friends find each other on Waves by number, so an account without one cannot
 * be found by the one thing people know about each other. This asks — and the
 * whole verification happens in the card, number then code, so saying yes never
 * means a trip into settings to hunt for the right row.
 *
 * How often it asks is `lib/phonePrompt`'s decision. It always stays optional.
 * The proving is the same Firebase-then-`phone-verify` path the
 * account screen uses (`startAddingContact` / `confirmContact`), so the two can
 * never disagree about what counts as a linked number.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, TextInput, useWindowDimensions, View } from 'react-native';

import { dialingCodeForCountry } from '@waves/core';
import { Button, Popup, Row, Text, useTheme } from '@waves/ui';

import { CountryCodePicker } from '@/components/CountryCodePicker';
import { ContactChannel, confirmContact, startAddingContact } from '@/data/api';
import { deviceCountry, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { useFlagEnabled } from '@/lib/flags';
import { phoneSignInAvailable } from '@/lib/phoneAuth';
import {
  localDay,
  PhonePromptMode,
  phonePromptMode,
  readPhonePromptShown,
  readPhonePromptState,
  withLater,
  writePhonePromptShown,
  writePhonePromptState,
  type PhonePromptState,
} from '@/lib/phonePrompt';
import { usePromptSlot } from '@/lib/promptQueue';

const ART = require('../../assets/images/phone-prompt-art.webp') as number;
const ART_COMPACT = require('../../assets/images/phone-prompt-art-compact.webp') as number;
const ART_CODE = require('../../assets/images/phone-prompt-art-code.webp') as number;

/** How long a code stays "just sent" before the retry link wakes up. */
const RETRY_SECONDS = 30;
const CODE_LEN = 6;

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${String(m).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The remote switch, in `feature_flags`. Off unless the table says on. */
const FLAG = 'phone_link_prompt';

enum Stage {
  Ask = 'ask',
  Number = 'number',
  Code = 'code',
  Done = 'done',
}

export function PhoneLinkPrompt() {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { t } = useStrings();
  const { session, profile, isGuest, refresh } = useAuth();
  const enabled = useFlagEnabled(FLAG);

  const ownerId = session?.user.id ?? null;
  const hasPhone = Boolean(session?.user.phone);

  // `null` until storage has answered for the current account, so the card never
  // flashes up and vanishes when a same-day "Later" loads a beat later.
  const [answer, setAnswer] = useState<{
    owner: string;
    state: PhonePromptState;
    shownOn: string | null;
  } | null>(null);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    void Promise.all([readPhonePromptState(ownerId), readPhonePromptShown(ownerId)]).then(
      ([state, shownOn]) => {
        if (!cancelled) setAnswer({ owner: ownerId, state, shownOn });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ownerId]);
  const state = answer && answer.owner === ownerId ? answer.state : null;

  const [stage, setStage] = useState<Stage>(Stage.Ask);
  const [country, setCountry] = useState<string>(profile?.country_code ?? deviceCountry() ?? 'IN');
  const [local, setLocal] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeFocused, setCodeFocused] = useState(true);
  // Seconds until a new code may be asked for; 0 means "tap to resend".
  const [retryLeft, setRetryLeft] = useState(0);
  useEffect(() => {
    if (stage !== Stage.Code || retryLeft <= 0) return undefined;
    const id = setTimeout(() => setRetryLeft((left) => left - 1), 1000);
    return () => clearTimeout(id);
  }, [stage, retryLeft]);

  const mode =
    ownerId && state
      ? phonePromptMode(
          { hasPhone, isGuest, canVerify: phoneSignInAvailable(), enabled },
          state,
          localDay(),
          answer?.shownOn ?? null,
        )
      : PhonePromptMode.Hidden;

  // Once linked the mode drops to hidden, but the "you're set" card is still
  // worth a moment on screen — so the done stage keeps the slot until closed.
  const wants = mode !== PhonePromptMode.Hidden || stage === Stage.Done;
  // Above the push ask: being findable is the reason the app works between
  // friends, and the push ask will still be there after. Below the restore
  // prompt, which is about data already on the account.
  const granted = usePromptSlot({
    id: 'phonePrompt',
    priority: 80,
    active: wants,
    delayMs: 400,
  });

  // Once it is on screen, today is spent, however it is closed. The answer read at mount is kept,
  // so the card stays up for this launch.
  const markedShown = useRef(false);
  useEffect(() => {
    if (!granted || !wants || !ownerId || markedShown.current) return;
    markedShown.current = true;
    void writePhonePromptShown(ownerId, localDay());
  }, [granted, wants, ownerId]);

  const number = `${dialingCodeForCountry(country) ?? ''}${local.replace(/[^\d]/g, '')}`;
  const looksValid = /^\+?[0-9]{8,15}$/.test(number);

  const later = useCallback((): void => {
    if (!ownerId || !state) return;
    const next = withLater(state, localDay());
    setStage(Stage.Ask);
    setLocal('');
    setError(null);
    setAnswer({ owner: ownerId, state: next, shownOn: answer?.shownOn ?? null });
    void writePhonePromptState(ownerId, next);
  }, [ownerId, state, answer]);

  const send = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await startAddingContact(ContactChannel.Phone, number);
      setCode('');
      setRetryLeft(RETRY_SECONDS);
      setStage(Stage.Code);
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'phonePrompt.send'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await confirmContact(ContactChannel.Phone, number, code);
      // The done stage first: the refresh is what makes the account read as
      // having a number, and with it the ask would drop out of the queue for a
      // render before the "you're set" card claimed it back.
      setStage(Stage.Done);
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'phonePrompt.confirm'));
      return;
    } finally {
      setBusy(false);
    }
    // Outside the try: the number is linked by now, and a refresh that fails is
    // not a failed link. `attachProof` already refreshed once; this is only so
    // the screen reads the new number without waiting for the token to roll.
    await refresh().catch(() => undefined);
  };

  if (!wants || !granted) return null;

  // The close does what "Later" does.
  const onClose = (): void => {
    if (stage === Stage.Done) {
      setStage(Stage.Ask);
      return;
    }
    later();
  };

  const art =
    stage === Stage.Code
      ? { source: ART_CODE, ratio: 650 / 222 }
      : stage === Stage.Number
        ? { source: ART_COMPACT, ratio: 580 / 220 }
        : { source: ART, ratio: 720 / 320 };

  const linkLabel = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={{
        alignSelf: 'center',
        paddingVertical: theme.spacing.sm,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text variant="body" tone="muted" style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );

  // The card is at most 380 wide, inset from the window, less its own padding.
  const artWidth = Math.max(
    0,
    Math.min(380, windowWidth - theme.spacing.xl * 2) - theme.spacing.lg * 2,
  );
  const [codeBefore, codeAfter] = t.phonePrompt.codeSent.split('{phone}');
  const retryReady = retryLeft <= 0 && !busy;

  return (
    <Popup
      visible
      onClose={onClose}
      dismissable
      closeLabel={t.phonePrompt.later}
      style={{
        maxWidth: 380,
        gap: theme.spacing.md,
        paddingTop: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.lg,
        borderRadius: 16,
      }}
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
      {/* Sized from the card, not '100%': on an iPad running the phone app in its
          window the percentage resolved against the wrong box and the art ran
          past the card's edge. Clipped to the card either way. */}
      <View style={{ width: artWidth, alignSelf: 'center', overflow: 'hidden' }}>
        <Image
          source={art.source}
          accessible={false}
          resizeMode="contain"
          style={{ width: artWidth, height: artWidth / art.ratio }}
        />
      </View>

      {stage === Stage.Done ? (
        <>
          <Text variant="body" align="center">
            {t.phonePrompt.done}
          </Text>
          <Button
            label={t.phonePrompt.doneAction}
            variant="brand"
            size="lg"
            fullWidth
            onPress={() => setStage(Stage.Ask)}
          />
        </>
      ) : (
        <>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="heading" align="center" style={{ fontWeight: '800' }}>
              {t.phonePrompt.title}
            </Text>
            {stage === Stage.Code ? (
              <Text variant="body" tone="muted" align="center">
                {codeBefore}
                <Text variant="subheading" tone="brand">
                  {number}
                </Text>
                {codeAfter}
              </Text>
            ) : (
              <Text variant="body" tone="muted" align="center">
                {t.phonePrompt.body}
              </Text>
            )}
          </View>

          {stage === Stage.Number ? (
            <Row
              style={{
                alignItems: 'center',
                borderWidth: 1.5,
                borderColor: theme.color.border,
                borderRadius: theme.radius.lg,
                overflow: 'hidden',
              }}
            >
              <CountryCodePicker
                bare
                code={country}
                onChange={(next) => {
                  if (busy) return;
                  setCountry(next);
                  setError(null);
                }}
              />
              <View
                style={{ width: 1.5, alignSelf: 'stretch', backgroundColor: theme.color.border }}
              />
              <TextInput
                value={local}
                onChangeText={(next) => {
                  setLocal(next);
                  setError(null);
                }}
                editable={!busy}
                autoFocus
                autoComplete="tel"
                keyboardType="phone-pad"
                accessibilityLabel={t.contact.phoneNumber}
                placeholder={t.contact.phonePlaceholder.replace('{code}', '').trim()}
                placeholderTextColor={theme.color.textFaint}
                style={{
                  flex: 1,
                  fontSize: 18,
                  color: theme.color.text,
                  paddingHorizontal: theme.spacing.md,
                  height: 52,
                }}
              />
            </Row>
          ) : null}

          {stage === Stage.Code ? (
            <>
              {/* Six drawn cells over one real field: the field owns the value,
                  the keyboard and the SMS autofill; the cells only read it. */}
              <View style={{ direction: 'ltr' }}>
                <Row style={{ gap: theme.spacing.sm }}>
                  {Array.from({ length: CODE_LEN }, (_, i) => {
                    const active = codeFocused && i === Math.min(code.length, CODE_LEN - 1);
                    return (
                      <View
                        key={i}
                        style={{
                          flex: 1,
                          aspectRatio: 0.95,
                          borderRadius: theme.radius.md,
                          borderWidth: 1.5,
                          borderColor: active ? theme.color.brand : theme.color.border,
                          backgroundColor: active ? theme.color.surface : theme.color.surfaceMuted,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 24, fontWeight: '700' }}>{code[i] ?? ''}</Text>
                      </View>
                    );
                  })}
                </Row>
                <TextInput
                  value={code}
                  onChangeText={(next) => {
                    setCode(next.replace(/\D/g, '').slice(0, CODE_LEN));
                    setError(null);
                  }}
                  editable={!busy}
                  autoFocus
                  keyboardType="number-pad"
                  maxLength={CODE_LEN}
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                  importantForAutofill="yes"
                  autoCorrect={false}
                  accessibilityLabel={t.contact.verificationCode}
                  onFocus={() => setCodeFocused(true)}
                  onBlur={() => setCodeFocused(false)}
                  // Over the cells so a tap lands on the field; invisible.
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    opacity: 0.02,
                    color: 'transparent',
                  }}
                />
              </View>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="caption" tone="muted">
                  {t.phonePrompt.didntReceive}
                </Text>
                <Pressable
                  onPress={() => void send()}
                  disabled={!retryReady}
                  accessibilityRole="button"
                  accessibilityLabel={
                    retryReady
                      ? t.phonePrompt.retry
                      : t.phonePrompt.retryIn.replace('{time}', clock(retryLeft))
                  }
                  accessibilityState={{ disabled: !retryReady }}
                  hitSlop={8}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    opacity: retryReady ? 1 : 0.8,
                  }}
                >
                  <Ionicons name="refresh" size={18} color={theme.color.brand} />
                  <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                    {retryReady
                      ? t.phonePrompt.retry
                      : t.phonePrompt.retryIn.replace('{time}', clock(retryLeft))}
                  </Text>
                </Pressable>
              </Row>
            </>
          ) : null}

          {error ? (
            <Text variant="caption" tone="negative" align="center">
              {error}
            </Text>
          ) : null}

          {/* The primary action, then a clear gap, then the quiet text actions. */}
          <View style={{ gap: theme.spacing.md }}>
            {stage === Stage.Ask ? (
              <Button
                label={t.phonePrompt.add}
                variant="brand"
                size="lg"
                fullWidth
                icon={<Ionicons name="call" size={20} color={theme.color.onBrand} />}
                onPress={() => setStage(Stage.Number)}
              />
            ) : null}
            {stage === Stage.Number ? (
              <Button
                label={t.phonePrompt.sendCode}
                variant="brand"
                size="lg"
                fullWidth
                icon={<Ionicons name="paper-plane" size={20} color={theme.color.onBrand} />}
                disabled={busy || !looksValid}
                onPress={() => void send()}
              />
            ) : null}
            {stage === Stage.Code ? (
              <>
                <Button
                  label={t.phonePrompt.confirm}
                  variant="brand"
                  size="lg"
                  fullWidth
                  disabled={busy || code.trim().length < CODE_LEN}
                  onPress={() => void confirm()}
                />
                {linkLabel(
                  t.phonePrompt.changeNumber,
                  () => {
                    setCode('');
                    setError(null);
                    setStage(Stage.Number);
                  },
                  busy,
                )}
              </>
            ) : null}
            {stage !== Stage.Code ? linkLabel(t.phonePrompt.later, later, busy) : null}
          </View>
        </>
      )}
    </Popup>
  );
}
