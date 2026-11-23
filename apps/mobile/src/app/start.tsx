/**
 * First run, for a brand-new account: three questions on one screen, swapped in
 * place (name, what brings you, say an expense), then wherever that points.
 *
 * Nothing here saves an expense: the mic step only shows what was heard, so the
 * first thing a new person sees the app do is understand them. Steps 1 and 2
 * sit on a photograph with a white sheet over it, as Home does; step 3 is the
 * night photograph with a glass card. The wash and glass tints are the same
 * fixed overlays the Home hero uses over its photographs.
 */

import { useRef, useState, type ComponentType } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { format, money } from '@waves/core';
import { Avatar, Button, iconSize, Text, useTheme, type TintName } from '@waves/ui';

import { HOME_HERO_PHOTOS } from '@/components/home/HomeHeroBackground';
import { avatarPhotoUrl } from '@/data/api';
import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useAvatarEditor } from '@/lib/avatarEditor';
import { track } from '@/lib/events';
import {
  firstRunSeenAfter,
  INTENTS,
  nameForField,
  routeForIntents,
  summariseHeard,
  type HeardExpense,
  type Intent,
} from '@/lib/firstRunFlow';
import { ensureMicPermission } from '@/lib/micPermission';
import { router } from '@/lib/navigation';
import { usePromptSlot } from '@/lib/promptQueue';
import { useReducedMotion } from '@/lib/reducedMotion';
import { COMPACT_TYPE_CAP } from '@/lib/typeCap';
import { useSignedUrl } from '@/lib/useSignedUrl';
import { patchUiPrefs } from '@/lib/uiPrefsStore';
import { useDefaultCurrency } from '@/lib/currency';

import type { HoldRecorderProps } from '@/components/voice/HoldRecorder';

// Native speech is absent in Expo Go and on web: the mic step then just offers typing.
interface Speech {
  getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }>;
}
const speech: Speech | null = (() => {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-speech-recognition') as { ExpoSpeechRecognitionModule: Speech })
      .ExpoSpeechRecognitionModule;
  } catch {
    return null;
  }
})();
const Recorder: ComponentType<HoldRecorderProps> | null = (() => {
  if (!speech) return null;
  try {
    const mod = // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/components/voice/HoldRecorder') as {
        HoldRecorder: ComponentType<HoldRecorderProps>;
      };
    return mod.HoldRecorder;
  } catch {
    return null;
  }
})();

const TILES: readonly { key: Intent; icon: keyof typeof Ionicons.glyphMap; tint: TintName }[] = [
  { key: 'trip', icon: 'airplane-outline', tint: 'sky' },
  { key: 'flat', icon: 'home-outline', tint: 'peach' },
  { key: 'family', icon: 'people-outline', tint: 'mint' },
  { key: 'couple', icon: 'heart-outline', tint: 'pink' },
  { key: 'own', icon: 'wallet-outline', tint: 'lilac' },
];

// Fixed overlays on a photograph, as the Home hero's scrim: not theme colours.
const GLASS = 'rgba(255, 255, 255, 0.18)';
const GLASS_EDGE = 'rgba(255, 255, 255, 0.34)';
const TRACK_OFF = 'rgba(255, 255, 255, 0.28)';
const WHITE = '#FFFFFF';
const PHOTO_W = 1440;
const PHOTO_H = 640;
const SHEET_RADIUS = 28;

type Step = 1 | 2 | 3;

function Photo({ source, width, height }: { source: number; width: number; height: number }) {
  // `cover` by hand with explicit sizes, as the Home hero does (release builds drop the bundled photo otherwise).
  const scale = Math.max(width / PHOTO_W, height / PHOTO_H);
  return (
    <Image
      source={source}
      accessibilityIgnoresInvertColors
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        position: 'absolute',
        width: PHOTO_W * scale,
        height: PHOTO_H * scale,
        left: (width - PHOTO_W * scale) / 2,
        top: height - PHOTO_H * scale,
      }}
    />
  );
}

export default function StartScreen() {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.firstRun;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { session, profile, isGuest, updateProfile } = useAuth();
  const avatar = useAvatarEditor();
  const photoUrl = useSignedUrl(profile?.avatar_url, avatarPhotoUrl);
  const currency = useDefaultCurrency();
  const reduceMotion = useReducedMotion();
  // Nothing may pop up over the flow (the lock, ads and asks all queue behind this).
  usePromptSlot({ id: 'first-run', priority: 1000, active: true });

  const [step, setStep] = useState<Step>(1);
  // The field shows the profile's name until the person types; the profile can land a beat late.
  const [typed, setTyped] = useState<string | null>(null);
  const name = typed ?? nameForField(profile?.display_name);
  const [intents, setIntents] = useState<readonly Intent[]>([]);
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const ownerId = session?.user.id ?? null;

  const finish = async (picked: readonly Intent[]): Promise<void> => {
    track('onboarding_completed', { screen: 'first_run' });
    if (ownerId) await firstRunSeenAfter(ownerId);
    router.replace(routeForIntents(picked, s.suggested) as never);
  };

  const saveName = async (): Promise<void> => {
    setSaving(true);
    try {
      if (trimmed && trimmed !== profile?.display_name)
        await updateProfile({ display_name: trimmed });
    } catch {
      // A name that did not save is asked for again in Settings; it must not stop the flow.
    } finally {
      setSaving(false);
    }
    setStep(2);
  };

  const saveIntents = (): void => {
    if (profile && intents.length > 0) {
      patchUiPrefs(profile.id, (prefs) => ({ ...prefs, intent: [...intents] }));
    }
    setStep(3);
  };

  const toggle = (key: Intent): void =>
    setIntents((now) => (now.includes(key) ? now.filter((k) => k !== key) : [...now, key]));

  // ── step 3: the mic ──
  const [recording, setRecording] = useState(false);
  const [lifted, setLifted] = useState(false);
  const [heard, setHeard] = useState<HeardExpense | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [words, setWords] = useState('');
  const held = useRef(false);

  const micDown = async (): Promise<void> => {
    if (!speech || !Recorder) return;
    held.current = true;
    setHeard(null);
    setNote(null);
    setWords('');
    const permission = await ensureMicPermission(speech);
    if (!permission.granted) {
      setNote(s.micOff);
      return;
    }
    if (!held.current) return;
    setLifted(false);
    setRecording(true);
  };
  const micUp = (): void => {
    held.current = false;
    setLifted(true);
  };
  const recorded = (said: string): void => {
    setRecording(false);
    setLifted(false);
    const result = summariseHeard(said);
    if (result) setHeard(result);
    else setNote(s.notHeard);
  };

  const chrome = (label: string, onPress: (() => void) | null) => (
    <View
      style={{
        position: 'absolute',
        top: insets.top + 12,
        start: 20,
        end: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flexDirection: 'row', gap: 6 }} accessibilityElementsHidden>
        {[1, 2, 3].map((n) => (
          <View
            key={n}
            style={{
              width: 34,
              height: 4,
              borderRadius: 2,
              backgroundColor: n <= step ? theme.color.brand : TRACK_OFF,
            }}
          />
        ))}
      </View>
      <Pressable
        disabled={!onPress}
        onPress={onPress ?? undefined}
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={label}
        hitSlop={8}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 7,
          borderRadius: theme.radius.pill,
          backgroundColor: GLASS,
          borderWidth: 1,
          borderColor: GLASS_EDGE,
        }}
      >
        <Text
          variant="caption"
          style={{ color: WHITE, fontWeight: '600' }}
          maxFontSizeMultiplier={COMPACT_TYPE_CAP}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );

  if (step === 3) {
    const bars = [14, 26, 38, 26, 14];
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.text }}>
        <Photo source={HOME_HERO_PHOTOS.night} width={width} height={height} />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(8, 12, 32, 0.45)', 'rgba(8, 12, 32, 0)', 'rgba(8, 12, 32, 0.5)']}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        />
        {chrome(s.typeInstead, () => void finish(intents))}
        <View style={{ position: 'absolute', start: 20, end: 20, top: insets.top + 96 }}>
          <Text variant="display" style={{ color: WHITE }} accessibilityRole="header">
            {s.voiceTitle}
          </Text>
          <Text variant="body" style={{ color: WHITE, opacity: 0.85, marginTop: 10 }}>
            {s.voiceHint}
          </Text>
          <View
            style={{
              marginTop: 14,
              padding: 16,
              borderRadius: theme.radius.xxl,
              backgroundColor: GLASS,
              borderWidth: 1,
              borderColor: GLASS_EDGE,
            }}
            accessibilityLiveRegion="polite"
          >
            {heard ? (
              <>
                <Text variant="caption" style={{ color: WHITE, opacity: 0.8 }}>
                  {s.heardTitle}
                </Text>
                <Text variant="heading" style={{ color: WHITE, marginTop: 4 }}>
                  {heard.note}
                </Text>
                <Text variant="body" style={{ color: WHITE, marginTop: 2 }}>
                  {format(money(BigInt(Math.round(heard.amount * 100)), currency), { locale })}
                  {heard.people ? `  ·  ${fill(s.people, { n: heard.people })}` : ''}
                </Text>
                <Text variant="caption" style={{ color: WHITE, opacity: 0.8, marginTop: 8 }}>
                  {s.notSaved}
                </Text>
              </>
            ) : (
              <Text variant="heading" style={{ color: WHITE }}>
                {recording ? words || s.listening : (note ?? s.sample)}
              </Text>
            )}
          </View>
        </View>
        <View
          style={{
            position: 'absolute',
            start: 0,
            end: 0,
            bottom: insets.bottom + 28,
            alignItems: 'center',
          }}
        >
          {heard ? (
            <View style={{ alignSelf: 'stretch', paddingHorizontal: 20 }}>
              <Button
                label={s.done}
                variant="brand"
                size="lg"
                fullWidth
                onPress={() => void finish(intents)}
              />
            </View>
          ) : (
            <>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: 44,
                  marginBottom: 16,
                }}
                accessibilityElementsHidden
              >
                {bars.map((h, i) => (
                  <View
                    key={i}
                    style={{
                      width: 5,
                      height: recording ? h + 6 : h,
                      borderRadius: 3,
                      backgroundColor: WHITE,
                      opacity: recording ? 1 : 0.7,
                    }}
                  />
                ))}
              </View>
              {Recorder ? (
                <Pressable
                  onPressIn={() => void micDown()}
                  onPressOut={micUp}
                  accessibilityRole="button"
                  accessibilityLabel={s.holdToSpeak}
                  style={{
                    width: 128,
                    height: 128,
                    borderRadius: 64,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: GLASS,
                  }}
                >
                  <View
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: 48,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.color.brand,
                      transform: [{ scale: recording && !reduceMotion ? 1.08 : 1 }],
                    }}
                  >
                    <Ionicons name="mic-outline" size={40} color={theme.color.onBrand} />
                  </View>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
        {recording && Recorder ? (
          <Recorder finish={lifted} onWords={setWords} onDone={(said) => recorded(said)} />
        ) : null}
      </View>
    );
  }

  const photoH = step === 1 ? Math.round(height * 0.4) : Math.round(height * 0.3);
  const first = trimmed.split(/\s+/)[0] ?? '';
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.color.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={{ height: photoH + SHEET_RADIUS, position: 'absolute', top: 0, left: 0, right: 0 }}
      >
        <Photo
          source={step === 1 ? HOME_HERO_PHOTOS.sunset : HOME_HERO_PHOTOS['late-morning']}
          width={width}
          height={photoH + SHEET_RADIUS}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(8, 12, 32, 0.5)', 'rgba(8, 12, 32, 0)']}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 140 }}
        />
      </View>
      {chrome(
        step === 1 ? fill(s.stepOf, { n: 1 }) : s.skip,
        step === 1 ? null : () => void finish([]),
      )}
      {step === 1 ? (
        <View
          style={{
            position: 'absolute',
            start: 0,
            end: 0,
            top: photoH * 0.5 - 52,
            alignItems: 'center',
          }}
        >
          <View style={{ borderRadius: 60, borderWidth: 4, borderColor: theme.color.surface }}>
            <Avatar
              name={trimmed || '?'}
              size={104}
              photoUrl={photoUrl}
              onPress={avatar.open}
              accessibilityLabel={s.addPhoto}
            />
          </View>
          <Pressable
            onPress={avatar.open}
            accessibilityRole="button"
            accessibilityLabel={s.addPhoto}
            style={{
              position: 'absolute',
              bottom: 0,
              marginStart: 80,
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.surface,
            }}
          >
            <Ionicons name="camera-outline" size={iconSize.md} color={theme.color.brand} />
          </Pressable>
        </View>
      ) : (
        <Text
          variant="heading"
          style={{ position: 'absolute', start: 20, top: photoH - 24, color: WHITE }}
        >
          {fill(s.hi, { name: first })} {'\u{1F44B}'}
        </Text>
      )}
      <View
        style={{
          flex: 1,
          marginTop: photoH,
          backgroundColor: theme.color.surface,
          borderTopStartRadius: SHEET_RADIUS,
          borderTopEndRadius: SHEET_RADIUS,
          paddingHorizontal: 20,
          paddingTop: 24,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <Text variant="display" accessibilityRole="header">
          {step === 1 ? s.nameTitle : s.intentTitle}
        </Text>
        <Text variant="body" tone="muted" style={{ marginTop: 6 }}>
          {step === 1 ? s.nameHint : s.intentHint}
        </Text>
        {step === 1 ? (
          <TextInput
            value={name}
            onChangeText={setTyped}
            placeholder={s.namePlaceholder}
            placeholderTextColor={theme.color.textFaint}
            accessibilityLabel={s.nameTitle}
            autoCapitalize="words"
            autoComplete="name"
            maxLength={60}
            returnKeyType="done"
            style={{
              marginTop: 16,
              height: 52,
              paddingHorizontal: 16,
              borderRadius: theme.radius.xxl,
              borderWidth: 1.5,
              borderColor: theme.color.brand,
              color: theme.color.text,
              fontSize: 17,
              textAlign: 'auto',
            }}
          />
        ) : (
          <View style={{ marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {INTENTS.map((key) => {
              const tile = TILES.find((x) => x.key === key)!;
              const on = intents.includes(key);
              const tint = theme.tint[tile.tint];
              return (
                <Pressable
                  key={key}
                  onPress={() => toggle(key)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={s.intents[key]}
                  style={{
                    flexBasis: key === 'own' ? '100%' : '48%',
                    flexGrow: 1,
                    flexDirection: key === 'own' ? 'row' : 'column',
                    alignItems: key === 'own' ? 'center' : 'flex-start',
                    gap: key === 'own' ? 14 : 10,
                    padding: 14,
                    borderRadius: theme.radius.xxl,
                    borderWidth: 1.5,
                    borderColor: on ? theme.color.brand : 'transparent',
                    backgroundColor: on ? theme.color.brandSoft : theme.color.surfaceMuted,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: theme.radius.lg,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: tint.bg,
                    }}
                  >
                    <Ionicons name={tile.icon} size={iconSize.xl} color={tint.ink} />
                  </View>
                  <Text variant="subheading" tone={on ? 'brand' : 'default'}>
                    {s.intents[key]}
                  </Text>
                  {on ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: 10,
                        end: 10,
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.color.brand,
                      }}
                    >
                      <Ionicons name="checkmark" size={iconSize.sm} color={theme.color.onBrand} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Button
          label={s.continue}
          variant="brand"
          size="lg"
          fullWidth
          disabled={saving || (step === 1 && !isGuest && trimmed === '')}
          onPress={() => (step === 1 ? void saveName() : saveIntents())}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
