/**
 * The ask to add a phone number, after sign-in, until one is linked.
 *
 * Friends find each other on Waves by number, so an account without one cannot
 * be found by the one thing people know about each other. This asks — and the
 * whole verification happens in the card, number then code, so saying yes never
 * means a trip into settings to hunt for the right row.
 *
 * How firmly it asks is `lib/phonePrompt`'s decision: "Later" puts it off for
 * the day, three times, and after that the card has no close — add a number or
 * sign out. The proving is the same Firebase-then-`phone-verify` path the
 * account screen uses (`startAddingContact` / `confirmContact`), so the two can
 * never disagree about what counts as a linked number.
 */

import { useCallback, useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TextInput, View } from 'react-native';

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
  readPhonePromptState,
  withLater,
  writePhonePromptState,
  type PhonePromptState,
} from '@/lib/phonePrompt';
import { usePromptSlot } from '@/lib/promptQueue';

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
  const { t } = useStrings();
  const { session, profile, isGuest, refresh, signOut } = useAuth();
  const enabled = useFlagEnabled(FLAG);

  const ownerId = session?.user.id ?? null;
  const hasPhone = Boolean(session?.user.phone);

  // `null` until storage has answered for the current account, so the card never
  // flashes up and vanishes when a same-day "Later" loads a beat later.
  const [answer, setAnswer] = useState<{ owner: string; state: PhonePromptState } | null>(null);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    void readPhonePromptState(ownerId).then((state) => {
      if (!cancelled) setAnswer({ owner: ownerId, state });
    });
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
  // A link attempt that failed — the number is already on another account, or
  // the day's codes are spent. A required ask must not trap somebody who tried:
  // after a failure it can be put off for the day like the soft one.
  const [failed, setFailed] = useState(false);

  const mode =
    ownerId && state
      ? phonePromptMode(
          { hasPhone, isGuest, canVerify: phoneSignInAvailable(), enabled },
          state,
          localDay(),
        )
      : PhonePromptMode.Hidden;

  // Once linked the mode drops to hidden, but the "you're set" card is still
  // worth a moment on screen — so the done stage keeps the slot until closed.
  const wants = mode !== PhonePromptMode.Hidden || stage === Stage.Done;
  // Above the push ask: being findable is the reason the app works between
  // friends, and the push ask will still be there after. Below the restore
  // prompt, which is about data already on the account.
  const granted = usePromptSlot({ id: 'phonePrompt', priority: 85, active: wants, delayMs: 400 });

  const required = mode === PhonePromptMode.Required;
  const number = `${dialingCodeForCountry(country) ?? ''}${local.replace(/[^\d]/g, '')}`;
  const looksValid = /^\+?[0-9]{8,15}$/.test(number);

  const canPutOff = !required || failed;

  const later = useCallback((): void => {
    if (!ownerId || !state || !canPutOff) return;
    const next = withLater(state, localDay());
    setStage(Stage.Ask);
    setLocal('');
    setError(null);
    setFailed(false);
    setAnswer({ owner: ownerId, state: next });
    void writePhonePromptState(ownerId, next);
  }, [ownerId, state, canPutOff]);

  const send = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await startAddingContact(ContactChannel.Phone, number);
      setStage(Stage.Code);
    } catch (caught) {
      setFailed(true);
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
      await refresh();
    } catch (caught) {
      setFailed(true);
      setError(friendlyError(caught, t.couldNotSave, 'phonePrompt.confirm'));
    } finally {
      setBusy(false);
    }
  };

  if (!wants || !granted) return null;

  const inputStyle = {
    fontSize: 16,
    color: theme.color.text,
    backgroundColor: theme.color.surfaceMuted,
    borderRadius: 14,
    paddingHorizontal: theme.spacing.md,
    height: 48,
  };

  // The close does what "Later" does. A required ask has nothing to close to
  // until an attempt has failed, so until then the scrim and the back button
  // both do nothing.
  const onClose = (): void => {
    if (stage === Stage.Done) {
      setStage(Stage.Ask);
      return;
    }
    later();
  };

  return (
    <Popup
      visible
      onClose={onClose}
      dismissable={canPutOff && stage !== Stage.Code}
      closeLabel={t.phonePrompt.later}
      style={{ maxWidth: 380, gap: theme.spacing.lg }}
    >
      <View
        style={{
          alignSelf: 'center',
          width: 72,
          height: 72,
          borderRadius: 18,
          backgroundColor: theme.color.brand,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name={stage === Stage.Done ? 'checkmark' : 'call'}
          size={36}
          color={theme.color.onBrand}
        />
      </View>

      {stage === Stage.Done ? (
        <>
          <Text variant="body" align="center">
            {t.phonePrompt.done}
          </Text>
          <Button
            label={t.phonePrompt.doneAction}
            size="lg"
            fullWidth
            onPress={() => setStage(Stage.Ask)}
          />
        </>
      ) : (
        <>
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="heading" align="center">
              {t.phonePrompt.title}
            </Text>
            <Text variant="body" tone="muted" align="center">
              {stage === Stage.Code
                ? t.phonePrompt.codeSent.replace('{phone}', number)
                : required
                  ? t.phonePrompt.requiredBody
                  : t.phonePrompt.body}
            </Text>
          </View>

          {stage === Stage.Number ? (
            <Row style={{ gap: theme.spacing.sm, alignItems: 'stretch' }}>
              <CountryCodePicker
                code={country}
                onChange={(next) => {
                  if (busy) return;
                  setCountry(next);
                  setError(null);
                }}
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
                style={[inputStyle, { flex: 1 }]}
              />
            </Row>
          ) : null}

          {stage === Stage.Code ? (
            <TextInput
              value={code}
              onChangeText={(next) => {
                setCode(next);
                setError(null);
              }}
              editable={!busy}
              autoFocus
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              accessibilityLabel={t.contact.verificationCode}
              placeholder="123456"
              placeholderTextColor={theme.color.textFaint}
              style={[inputStyle, { textAlign: 'center', fontWeight: '700', letterSpacing: 6 }]}
            />
          ) : null}

          {error ? (
            <Text variant="caption" tone="negative" align="center">
              {error}
            </Text>
          ) : null}

          <View style={{ gap: theme.spacing.sm }}>
            {stage === Stage.Ask ? (
              <Button
                label={t.phonePrompt.add}
                size="lg"
                fullWidth
                onPress={() => setStage(Stage.Number)}
              />
            ) : null}
            {stage === Stage.Number ? (
              <Button
                label={t.phonePrompt.sendCode}
                size="lg"
                fullWidth
                disabled={busy || !looksValid}
                onPress={() => void send()}
              />
            ) : null}
            {stage === Stage.Code ? (
              <>
                <Button
                  label={t.phonePrompt.confirm}
                  size="lg"
                  fullWidth
                  disabled={busy || code.trim().length < 6}
                  onPress={() => void confirm()}
                />
                <Button
                  label={t.phonePrompt.changeNumber}
                  variant="ghost"
                  size="lg"
                  fullWidth
                  disabled={busy}
                  onPress={() => {
                    setCode('');
                    setError(null);
                    setStage(Stage.Number);
                  }}
                />
              </>
            ) : null}
            {stage !== Stage.Code && canPutOff ? (
              <Button
                label={t.phonePrompt.later}
                variant="ghost"
                size="lg"
                fullWidth
                disabled={busy}
                onPress={later}
              />
            ) : null}
            {stage !== Stage.Code && required ? (
              <Button
                label={t.phonePrompt.signOut}
                variant="ghost"
                size="lg"
                fullWidth
                disabled={busy}
                onPress={() => void signOut()}
              />
            ) : null}
          </View>
        </>
      )}
    </Popup>
  );
}
