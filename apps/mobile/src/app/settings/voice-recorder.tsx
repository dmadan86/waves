/**
 * Voice test recorder: a hidden tester tool that collects real voice
 * recordings for the name/amount recognition bench.
 *
 * Everything stays on the phone. A take is saved as a 16 kHz mono WAV in a
 * session folder under the app's documents directory, with a manifest beside
 * it; the only way anything leaves is the tester pressing "Share recordings".
 * Prompts come from the tester's own groups and members plus fixed traps — see
 * `voiceRecorderPure`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  Button,
  Card,
  Chip,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useGroups, useHomeSummary } from '@/data/hooks';
import { displayName, isViewer } from '@/data/types';
import { deviceLocale, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';
import {
  createSession,
  deleteAllRecordings,
  deleteTake,
  deviceInfo,
  EMPTY_PROFILE,
  loadLatestSession,
  loadProfile,
  onDeviceFileSupported,
  recorderAvailable,
  requestMic,
  saveProfile,
  shareSession,
  speakerOf,
  startTake,
  transcribeOnDevice,
  writeManifest,
  writeTake,
  type RecorderProfile,
  type Take,
} from '@/lib/voiceRecorder';
import {
  buildManifest,
  generatePrompts,
  nextUnrecorded,
  sessionIdFor,
  upsertItem,
  type RecorderGroup,
  type RecorderManifest,
} from '@/lib/voiceRecorderPure';

type Phase = 'idle' | 'recording' | 'saving' | 'recorded';

const BACKGROUNDS = ['english', 'tamil', 'hindi', 'arabic', 'other'] as const;
const ACCENTS = [
  'indian',
  'south-indian',
  'north-indian',
  'gulf',
  'british',
  'american',
  'other',
] as const;

export default function VoiceRecorderScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const { profile: me } = useAuth();
  const groups = useGroups();
  const summary = useHomeSummary(me?.id ?? null);
  const { confirm } = useDialog();

  const [profile, setProfile] = useState<RecorderProfile | null>(null);
  const [initial] = useState(() => loadLatestSession());
  const [manifest, setManifest] = useState<RecorderManifest | null>(initial);
  const [index, setIndex] = useState(() =>
    initial ? nextUnrecorded(initial.prompts, initial.items) : 0,
  );
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const take = useRef<Take | null>(null);
  const stopping = useRef(false);

  const available = useMemo(() => recorderAvailable(), []);
  const onDevice = useMemo(() => onDeviceFileSupported(), []);

  useEffect(() => {
    let live = true;
    void loadProfile().then((loaded) => live && setProfile(loaded));
    return () => {
      live = false;
      void take.current?.stop();
    };
  }, []);

  const recorderGroups = useMemo<RecorderGroup[]>(
    () =>
      groups.data.map((group) => ({
        name: group.name ?? '',
        currency: group.default_currency,
        members: summary
          .membersFor(group.id)
          .filter((member) => !isViewer(member, me?.id))
          .map((member) => displayName(member, me?.id)),
      })),
    [groups.data, summary, me?.id],
  );

  const persist = useCallback((next: RecorderManifest) => {
    setManifest(next);
    try {
      writeManifest(next);
    } catch {
      setMessage('Could not write the manifest.');
    }
  }, []);

  const startSession = useCallback(
    (current: RecorderProfile) => {
      const now = new Date();
      const sessionId = sessionIdFor(now);
      const prompts = generatePrompts({
        groups: recorderGroups.filter((group) => group.name.length > 0),
        seed: now.getTime(),
      });
      createSession(sessionId);
      persist(
        buildManifest({
          sessionId,
          createdAt: now.toISOString(),
          speaker: speakerOf(current),
          device: deviceInfo(deviceLocale()),
          onDeviceSupported: onDevice,
          prompts,
          items: [],
        }),
      );
      setIndex(0);
      setPhase('idle');
      setMessage(null);
    },
    [persist, recorderGroups, onDevice],
  );

  const finishTake = useCallback(async () => {
    if (!manifest || !take.current || stopping.current) return;
    stopping.current = true;
    const active = take.current;
    take.current = null;
    setPhase('saving');
    try {
      const pcm = await active.stop();
      const prompt = manifest.prompts[index];
      // Under ~0.3 s is a mis-tap or silence, not a sentence.
      if (!prompt || pcm.length < 9600) {
        setMessage(t.voiceRecorder.noSpeech);
        setPhase('idle');
        return;
      }
      const saved = writeTake(manifest.sessionId, prompt.id, pcm);
      const result = await transcribeOnDevice(saved.uri, deviceLocale());
      persist({
        ...manifest,
        items: upsertItem(manifest.items, {
          id: prompt.id,
          promptText: prompt.text,
          expected: prompt.expected,
          file: saved.file,
          durationMs: saved.durationMs,
          recordedAt: new Date().toISOString(),
          onDevice: result,
        }),
      });
      setMessage(null);
      setPhase('recorded');
    } catch {
      setMessage(t.voiceRecorder.unavailable);
      setPhase('idle');
    } finally {
      stopping.current = false;
      setLevel(0);
    }
  }, [manifest, index, persist, t.voiceRecorder.noSpeech, t.voiceRecorder.unavailable]);

  const onRecordPress = useCallback(async () => {
    if (phase === 'recording') {
      await finishTake();
      return;
    }
    if (phase !== 'idle') return;
    if (!(await requestMic())) {
      setMessage(t.voiceRecorder.micDenied);
      return;
    }
    const started = await startTake(setLevel, () => void finishTake());
    if (!started) {
      setMessage(t.voiceRecorder.unavailable);
      return;
    }
    take.current = started;
    setMessage(null);
    setPhase('recording');
  }, [phase, finishTake, t.voiceRecorder.micDenied, t.voiceRecorder.unavailable]);

  const reRecord = useCallback(() => {
    const prompt = manifest?.prompts[index];
    const old = manifest?.items.find((item) => item.id === prompt?.id);
    if (manifest && old) deleteTake(manifest.sessionId, old.file);
    setPhase('idle');
  }, [manifest, index]);

  const next = useCallback(() => {
    setIndex((value) => value + 1);
    setPhase('idle');
    setMessage(null);
  }, []);

  const share = useCallback(async () => {
    if (!manifest) return;
    setBusy(true);
    try {
      const ok = await shareSession(manifest.sessionId);
      setMessage(ok ? null : t.voiceRecorder.shareUnavailable);
    } catch {
      setMessage(t.voiceRecorder.shareFailed);
    } finally {
      setBusy(false);
    }
  }, [manifest, t.voiceRecorder.shareFailed, t.voiceRecorder.shareUnavailable]);

  const confirmDelete = useCallback(async () => {
    const ok = await confirm({
      title: t.voiceRecorder.deleteTitle,
      body: t.voiceRecorder.deleteBody,
      confirmLabel: t.voiceRecorder.deleteConfirm,
      tone: 'danger',
    });
    if (!ok) return;
    deleteAllRecordings();
    setManifest(null);
    setIndex(0);
    setPhase('idle');
  }, [confirm, t.voiceRecorder]);

  const total = manifest?.prompts.length ?? 0;
  const prompt = manifest?.prompts[index] ?? null;
  const done = manifest !== null && index >= total;
  const recordedCount = manifest?.items.length ?? 0;

  const chipLabels: Record<string, string> = {
    english: t.voiceRecorder.bgEnglish,
    tamil: t.voiceRecorder.bgTamil,
    hindi: t.voiceRecorder.bgHindi,
    arabic: t.voiceRecorder.bgArabic,
    other: t.voiceRecorder.bgOther,
    indian: t.voiceRecorder.accentIndian,
    'south-indian': t.voiceRecorder.accentSouthIndian,
    'north-indian': t.voiceRecorder.accentNorthIndian,
    gulf: t.voiceRecorder.accentGulf,
    british: t.voiceRecorder.accentBritish,
    american: t.voiceRecorder.accentAmerican,
  };
  const accentLabel = (key: string): string =>
    key === 'other' ? t.voiceRecorder.accentOther : (chipLabels[key] ?? key);

  const updateProfile = (patch: Partial<RecorderProfile>): void =>
    setProfile((current) => ({ ...(current ?? EMPTY_PROFILE), ...patch }));

  const consent = profile && !profile.consented;

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
          <Text variant="heading">{t.voiceRecorder.title}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.lg,
        }}
      >
        {!available ? (
          <Text variant="caption" tone="muted">
            {t.voiceRecorder.unavailable}
          </Text>
        ) : null}

        {consent ? (
          <>
            <Card style={{ gap: theme.spacing.sm }}>
              <Text variant="subheading">{t.voiceRecorder.consentTitle}</Text>
              <Text variant="caption" tone="muted">
                {t.voiceRecorder.consentBody}
              </Text>
              <Text variant="caption" tone="muted">
                {t.voiceRecorder.consentNames}
              </Text>
            </Card>
            <Card style={{ gap: theme.spacing.sm }}>
              <Text variant="caption" tone="muted">
                {t.voiceRecorder.labelField}
              </Text>
              <TextInput
                value={profile.label}
                onChangeText={(label) => updateProfile({ label })}
                placeholder={t.voiceRecorder.labelPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.voiceRecorder.labelField}
                maxLength={80}
                style={{ fontSize: 16, color: theme.color.text, paddingVertical: 6 }}
              />
              <Text variant="caption" tone="muted">
                {t.voiceRecorder.backgroundField}
              </Text>
              <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {BACKGROUNDS.map((key) => (
                  <Chip
                    key={key}
                    label={chipLabels[key]!}
                    selected={profile.languageBackground === key}
                    onPress={() =>
                      updateProfile({
                        languageBackground: profile.languageBackground === key ? null : key,
                      })
                    }
                  />
                ))}
              </Row>
              <Text variant="caption" tone="muted">
                {t.voiceRecorder.accentField}
              </Text>
              <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {ACCENTS.map((key) => (
                  <Chip
                    key={key}
                    label={accentLabel(key)}
                    selected={profile.accent === key}
                    onPress={() => updateProfile({ accent: profile.accent === key ? null : key })}
                  />
                ))}
              </Row>
            </Card>
            <Button
              label={t.voiceRecorder.consentAgree}
              disabled={profile.label.trim().length === 0}
              onPress={() => {
                const agreed = { ...profile, consented: true, label: profile.label.trim() };
                setProfile(agreed);
                void saveProfile(agreed);
              }}
            />
          </>
        ) : null}

        {profile?.consented && (!manifest || done) ? (
          <Card style={{ gap: theme.spacing.md }}>
            {done ? (
              <Text variant="subheading">{t.voiceRecorder.allDone}</Text>
            ) : (
              <Text variant="caption" tone="muted">
                {onDevice ? t.voiceRecorder.onDeviceOn : t.voiceRecorder.onDeviceOff}
              </Text>
            )}
            <Button
              label={done ? t.voiceRecorder.newSession : t.voiceRecorder.startSession}
              disabled={!available}
              onPress={() => startSession(profile)}
            />
          </Card>
        ) : null}

        {profile?.consented && manifest && prompt ? (
          <Card style={{ gap: theme.spacing.lg, alignItems: 'center' }}>
            <Text variant="caption" tone="muted">
              {t.voiceRecorder.progress
                .replace('{n}', String(index + 1))
                .replace('{total}', String(total))}
            </Text>
            <Text variant="title" align="center">
              {prompt.text}
            </Text>
            <Text variant="micro" tone="faint" align="center">
              {phase === 'recording' ? t.voiceRecorder.listening : t.voiceRecorder.traps}
            </Text>
            <View
              style={{
                height: 4,
                width: '100%',
                borderRadius: 2,
                backgroundColor: theme.color.border,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  height: 4,
                  width: `${Math.round(level * 100)}%`,
                  backgroundColor: theme.color.text,
                }}
              />
            </View>
            {phase === 'recorded' ? (
              <Row style={{ gap: theme.spacing.md }}>
                <Button
                  label={t.voiceRecorder.reRecord}
                  variant="secondary"
                  onPress={reRecord}
                  style={{ flex: 1 }}
                />
                <Button
                  label={index + 1 >= total ? t.voiceRecorder.finish : t.voiceRecorder.next}
                  onPress={next}
                  style={{ flex: 1 }}
                />
              </Row>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    phase === 'recording' ? t.voiceRecorder.tapToStop : t.voiceRecorder.tapToRecord
                  }
                  disabled={phase === 'saving' || !available}
                  onPress={() => void onRecordPress()}
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 36,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor:
                      phase === 'recording' ? theme.color.negative : theme.color.text,
                    opacity: phase === 'saving' ? 0.5 : 1,
                  }}
                >
                  <Ionicons
                    name={phase === 'recording' ? 'stop' : 'mic'}
                    size={iconSize.lg}
                    color={theme.color.bg}
                  />
                </Pressable>
                <Text variant="caption" tone="muted">
                  {phase === 'saving'
                    ? t.voiceRecorder.saving
                    : phase === 'recording'
                      ? t.voiceRecorder.tapToStop
                      : t.voiceRecorder.tapToRecord}
                </Text>
                {phase === 'idle' ? (
                  <Button label={t.voiceRecorder.skip} variant="ghost" size="sm" onPress={next} />
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        {message ? (
          <Text variant="caption" tone="muted" align="center">
            {message}
          </Text>
        ) : null}

        {profile?.consented && manifest && recordedCount > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={busy ? t.voiceRecorder.sharing : t.voiceRecorder.shareRecordings}
              variant="secondary"
              disabled={busy}
              onPress={() => void share()}
            />
            <Button
              label={t.voiceRecorder.deleteAll}
              variant="ghostDanger"
              onPress={() => void confirmDelete()}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
