/**
 * The one-time ask for the app lock. The lock is off until somebody says yes:
 * on Home, from the launch after they signed up, once. "Turn on" proves the
 * device can unlock (the system sheet); "Not now", the close button, a backdrop
 * tap or Android back stores a no, and Settings > Privacy can still turn it on later.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSegments } from 'expo-router';
import { Modal, Platform, Pressable, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { IconDisc } from '@/components/company/dashboard/overviewKit';
import { useStrings } from '@/i18n';
import { useLock } from '@/lib/lock';
import { usePromptSlot } from '@/lib/promptQueue';

export function LockPrompt() {
  const { t } = useStrings();
  const theme = useTheme();
  const { shouldAsk, locked, setEnabled } = useLock();
  const onHome = useSegments()[0] === '(tabs)';
  const [open, setOpen] = useState(false);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  // Answered this launch, however it went: the slot goes back to the queue even
  // when a cancelled check stored nothing (the ask then returns next launch).
  const [done, setDone] = useState(false);
  const granted = usePromptSlot({
    id: 'lockPrompt',
    priority: 90,
    active: shouldAsk && !done && !locked && onHome,
    delayMs: 300,
  });
  const asked = useRef(false);

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        answer.current = resolve;
        setOpen(true);
      }),
    [],
  );
  const reply = (yes: boolean) => {
    setOpen(false);
    answer.current?.(yes);
    answer.current = null;
  };

  useEffect(() => {
    if (!granted || asked.current) return;
    asked.current = true;
    void (async () => {
      const yes = await ask();
      // A cancelled fingerprint check stores nothing, so the ask returns next launch.
      try {
        await setEnabled(yes);
      } finally {
        setDone(true);
      }
    })();
  }, [granted, ask, setEnabled]);

  const brand = theme.color.brand;
  const features = [
    { icon: 'finger-print', label: t.lock.askFingerprint },
    {
      icon: 'scan-outline',
      label: Platform.OS === 'android' ? t.lock.askFaceAndroid : t.lock.askFace,
    },
    { icon: 'lock-closed-outline', label: t.lock.askPasscode },
  ] as const;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => reply(false)}>
      <Pressable
        accessibilityLabel={t.entry.notifyNotNow}
        onPress={() => reply(false)}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg,
        }}
      >
        {/* Swallows taps so only the backdrop dismisses. */}
        <Pressable
          accessible={false}
          style={{
            width: '100%',
            maxWidth: 380,
            borderRadius: 24,
            backgroundColor: theme.color.surface,
            padding: theme.spacing.lg,
            gap: theme.spacing.md,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            onPress={() => reply(false)}
            style={{
              position: 'absolute',
              top: 8,
              end: 8,
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: theme.color.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="close" size={18} color={theme.color.text} />
            </View>
          </Pressable>

          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              alignSelf: 'center',
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: theme.color.brandSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="shield" size={84} color={brand} />
            <View style={{ position: 'absolute' }}>
              <Ionicons name="finger-print" size={40} color={theme.color.onBrand} />
            </View>
            <View style={{ position: 'absolute', end: 6, bottom: 6 }}>
              <Ionicons name="phone-portrait" size={44} color={theme.color.text} />
              <View
                style={{ position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center' }}
              >
                <Ionicons name="lock-closed" size={18} color={theme.color.surface} />
              </View>
            </View>
          </View>

          <Text variant="title" style={{ textAlign: 'center', fontWeight: '800' }}>
            {t.lock.askTitle}
          </Text>
          <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
            {t.lock.askBody}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
            {features.map((f, i) => (
              <View
                key={f.icon}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  paddingHorizontal: 4,
                  borderLeftWidth: i ? 1 : 0,
                  borderLeftColor: theme.color.border,
                }}
              >
                <IconDisc ink={brand} size={40}>
                  <Ionicons name={f.icon} size={22} color={brand} />
                </IconDisc>
                <Text variant="micro" tone="muted" style={{ textAlign: 'center' }}>
                  {f.label}
                </Text>
              </View>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.lock.askYes}
            onPress={() => reply(true)}
            style={{
              minHeight: 48,
              borderRadius: 14,
              backgroundColor: brand,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.xs,
            }}
          >
            <Ionicons name="lock-closed" size={18} color={theme.color.onBrand} />
            <Text variant="body" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
              {t.lock.askYes}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.entry.notifyNotNow}
            onPress={() => reply(false)}
            style={{
              minHeight: 48,
              borderRadius: 14,
              backgroundColor: theme.color.brandSoft,
              borderWidth: 1,
              borderColor: brand,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="body" style={{ color: brand, fontWeight: '700' }}>
              {t.entry.notifyNotNow}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
