/**
 * Two-step login: the code this phone makes, a new phone waiting to be let in,
 * and an optional authenticator app. One screen; it changes in place.
 * The app lock already covers every screen, so nothing extra gates it.
 */

import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, TextInput, View } from 'react-native';

import { Button, Text, useTabBarClearance, useTheme } from '@waves/ui';
import { totpSecondsLeft } from '@waves/core';

import { ScenicBody, ScenicHeader, SectionLabel, StandardCard } from '@/components/standard';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { codeFor, readSecret, type TrustResult } from '@/lib/twoStep';
import {
  confirmAuthenticator,
  startAuthenticator,
  useTrustPhone,
  useTwoStepStatus,
} from '@/lib/useTwoStep';

export default function TwoStepScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const toast = useToast();
  const viewer = useViewerId();
  const trust = useTrustPhone();
  const status = useTwoStepStatus();

  const [result, setResult] = useState<TrustResult | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');

  const check = useCallback(
    async (code?: string) => {
      setBusy(true);
      const next = await trust(code);
      if (viewer) setSecret(await readSecret(viewer));
      setResult(next);
      setBusy(false);
      return next;
    },
    [trust, viewer],
  );
  useFocusEffect(
    useCallback(() => {
      void check();
    }, [check]),
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const problem = (r: TrustResult): string | null =>
    r.status === 'badCode'
      ? t.twoStep.wrongCode
      : r.status === 'locked'
        ? t.twoStep.locked
        : r.status === 'rateLimited'
          ? t.common.tooFastMoment
          : r.status === 'update'
            ? t.twoStep.updateWaves
            : r.status === 'unavailable'
              ? t.twoStep.tryLater
              : null;

  const submitTyped = async () => {
    const next = await check(typed);
    if (next.status === 'trusted') {
      setTyped('');
      toast.show(t.twoStep.verified, 'positive');
    } else {
      const message = problem(next);
      if (message) toast.show(message, 'negative');
    }
  };

  const begin = async () => {
    setBusy(true);
    try {
      setSetup(await startAuthenticator(viewer ?? ''));
    } catch (error) {
      toast.show(
        error instanceof Error && error.message === 'TWO_STEP_REQUIRED'
          ? t.twoStep.verifyFirst
          : t.twoStep.tryLater,
        'negative',
      );
    }
    setBusy(false);
  };
  const confirm = async () => {
    setBusy(true);
    const done = await confirmAuthenticator(confirmCode);
    setBusy(false);
    if (done === 'ok') {
      setSetup(null);
      setConfirmCode('');
      void status.refetch();
      toast.show(t.twoStep.authenticatorOn, 'positive');
    } else {
      toast.show(done === 'badCode' ? t.twoStep.wrongCode : t.twoStep.tryLater, 'negative');
    }
  };

  const code = codeFor(secret, now);
  const waiting = result?.status === 'pending' && !code;
  const input = (value: string, onChange: (v: string) => void, label: string) => (
    <TextInput
      value={value}
      onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, 6))}
      keyboardType="number-pad"
      maxLength={6}
      placeholder="000000"
      placeholderTextColor={theme.color.textFaint}
      accessibilityLabel={label}
      style={{
        fontSize: 22,
        letterSpacing: 6,
        textAlign: 'center',
        paddingVertical: 10,
        borderRadius: theme.radius.md,
        backgroundColor: theme.color.bg,
        color: theme.color.text,
      }}
    />
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.color.bg }}
      contentContainerStyle={{ paddingBottom: clearance }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void check()} />}
      showsVerticalScrollIndicator={false}
    >
      <ScenicHeader title={t.twoStep.title} />
      <ScenicBody>
        {waiting ? (
          <StandardCard style={{ gap: theme.spacing.md }}>
            <SectionLabel icon="phone-portrait-outline">{t.twoStep.newPhoneTitle}</SectionLabel>
            <Text variant="body" tone="muted">
              {t.twoStep.newPhoneBody}
            </Text>
            {input(typed, setTyped, t.twoStep.codeLabel)}
            <Button
              label={t.twoStep.continue}
              disabled={busy || typed.length !== 6}
              onPress={() => void submitTyped()}
            />
            <Button
              label={t.twoStep.checkAgain}
              variant="secondary"
              disabled={busy}
              onPress={() => void check()}
            />
          </StandardCard>
        ) : code ? (
          <StandardCard style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
            <SectionLabel icon="key-outline">{t.twoStep.yourCode}</SectionLabel>
            <Text style={{ fontSize: 40, fontWeight: '800', letterSpacing: 8 }} selectable>
              {code}
            </Text>
            <Text variant="caption" tone="muted">
              {fill(t.twoStep.newCodeIn, { n: totpSecondsLeft(now) })}
            </Text>
            <Text variant="caption" tone="muted" align="center">
              {t.twoStep.codeHint}
            </Text>
          </StandardCard>
        ) : result && problem(result) ? (
          <StandardCard style={{ gap: theme.spacing.sm }}>
            <Text variant="body" tone="muted">
              {problem(result)}
            </Text>
          </StandardCard>
        ) : null}

        {!waiting ? (
          <StandardCard style={{ gap: theme.spacing.md }}>
            <SectionLabel icon="apps-outline">{t.twoStep.authenticatorTitle}</SectionLabel>
            {status.data?.hasAuthenticator && !setup ? (
              <Text variant="body" tone="muted">
                {t.twoStep.authenticatorOn}
              </Text>
            ) : null}
            {setup ? (
              <>
                <Text variant="body" tone="muted">
                  {t.twoStep.authenticatorSteps}
                </Text>
                <Text selectable style={{ fontSize: 16, fontWeight: '700', letterSpacing: 1 }}>
                  {setup.secret}
                </Text>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={t.twoStep.copyKey}
                      variant="secondary"
                      onPress={() => {
                        void Clipboard.setStringAsync(setup.secret);
                        toast.show(t.twoStep.copied, 'positive');
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={t.twoStep.openAuthenticator}
                      variant="secondary"
                      onPress={() => void Linking.openURL(setup.uri).catch(() => undefined)}
                    />
                  </View>
                </View>
                {input(confirmCode, setConfirmCode, t.twoStep.codeLabel)}
                <Button
                  label={t.twoStep.confirm}
                  disabled={busy || confirmCode.length !== 6}
                  onPress={() => void confirm()}
                />
              </>
            ) : (
              <Button
                label={
                  status.data?.hasAuthenticator
                    ? t.twoStep.replaceAuthenticator
                    : t.twoStep.addAuthenticator
                }
                variant="secondary"
                disabled={busy}
                onPress={() => void begin()}
              />
            )}
          </StandardCard>
        ) : null}
      </ScenicBody>
    </ScrollView>
  );
}
