/**
 * The one-time "send my voice to third-party AI?" sheet (Apple 5.1.2(i)).
 *
 * Names the providers, says what each receives, and asks. "Allow" records the
 * consent; "Not now" (or dismissing) records nothing, so the caller keeps the
 * on-device voice and asks again next time.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Button, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

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
  return (
    <Sheet visible={visible} onClose={onNotNow} closeLabel={t.common.close}>
      <Row style={{ gap: theme.spacing.md, marginBottom: theme.spacing.sm, alignItems: 'center' }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="mic-outline" size={iconSize.md} color={theme.color.brand} />
        </View>
        <Text variant="title" style={{ flex: 1 }}>
          {t.voiceConsent.title}
        </Text>
      </Row>
      <Text variant="body" tone="muted">
        {t.voiceConsent.body}
      </Text>
      <Text
        variant="caption"
        accessibilityRole="link"
        onPress={learnMore}
        style={{
          color: theme.color.brand,
          textDecorationLine: 'underline',
          marginTop: theme.spacing.sm,
          alignSelf: 'flex-start',
        }}
      >
        {t.voiceConsent.learnMore}
      </Text>
      <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
        <Button label={t.voiceConsent.allow} fullWidth onPress={onAllow} />
        <Button label={t.voiceConsent.notNow} variant="secondary" fullWidth onPress={onNotNow} />
      </View>
    </Sheet>
  );
}
