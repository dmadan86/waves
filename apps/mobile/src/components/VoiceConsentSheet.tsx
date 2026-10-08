/**
 * The one-time "send my voice to third-party AI?" sheet (Apple 5.1.2(i)).
 *
 * Names the providers, says what each receives, and asks. "Allow" records the
 * consent; "Not now" (or dismissing) records nothing, so the caller keeps the
 * on-device voice and asks again next time.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, View } from 'react-native';

import { Button, directionalIcon, iconSize, Sheet, Text, useTheme } from '@waves/ui';

import { InfoRowsCard } from '@/components/InfoRowsCard';
import type { InfoRow } from '@/components/InfoRowsCard';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

const CONSENT_ART = require('../../assets/images/voice-consent-art.webp') as number;
// The art is 325x276; fixed sizes because a percentage width with an aspect
// ratio renders zoomed and cropped on Android.
const ART_W = 140;
const ART_H = 119;

export function VoiceConsentSheet({
  visible,
  onAllow,
  onNotNow,
}: {
  visible: boolean;
  onAllow: () => void;
  onNotNow: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const learnMore = (): void => {
    // The privacy screen opens over a closed sheet: a modal would hide it.
    onNotNow();
    router.push('/settings/privacy');
  };
  const c = t.voiceConsent;
  const rows: readonly InfoRow[] = [
    { icon: 'pulse', tint: 'sky', title: c.step1Title, body: c.step1Body },
    { icon: 'document-text', tint: 'lilac', title: c.step2Title, body: c.step2Body },
    { icon: 'shield-checkmark', tint: 'mint', title: c.step3Title, body: c.step3Body },
  ];
  return (
    <Sheet visible={visible} onClose={onNotNow} closeLabel={t.common.close} padded={false}>
      <View style={{ minHeight: ART_H, justifyContent: 'center' }}>
        {/* Bleeds to the sheet's top-end corner; start-aligned text sits over its soft fade. */}
        <Image
          source={CONSENT_ART}
          accessibilityIgnoresInvertColors
          importantForAccessibility="no"
          resizeMode="contain"
          style={{
            position: 'absolute',
            top: 0,
            end: 0,
            width: ART_W,
            height: ART_H,
            opacity: theme.scheme === 'dark' ? 0.55 : 1,
          }}
        />
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingEnd: ART_W - theme.spacing.xs,
            gap: theme.spacing.xs,
          }}
        >
          <Text variant="title" accessibilityRole="header">
            {c.title}
          </Text>
          <Text variant="caption" tone="muted">
            {c.subtitle}
          </Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm }}>
        <InfoRowsCard rows={rows} connected />
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={c.learnMore}
          onPress={learnMore}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            backgroundColor: theme.color.brandSoft,
            borderRadius: theme.radius.pill,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
          }}
        >
          <Ionicons
            name="information-circle-outline"
            size={iconSize.md}
            color={theme.color.brand}
          />
          <Text variant="caption" style={{ flex: 1, color: theme.color.brand }} numberOfLines={2}>
            {c.learnMore}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={theme.color.brand}
          />
        </Pressable>
        <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
          <Button
            label={c.allow}
            variant="brand"
            fullWidth
            onPress={onAllow}
            icon={<Ionicons name="mic" size={iconSize.md} color={theme.color.onBrand} />}
          />
          <Button label={c.notNow} variant="secondary" fullWidth onPress={onNotNow} />
        </View>
      </View>
    </Sheet>
  );
}
