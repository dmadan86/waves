/**
 * Security.
 *
 * Two settings. The lock guards the screen when the phone is handed over; the
 * delay decides how often that guard gets in the way of the person who owns it.
 * Both matter, because a lock that asks too often is a lock somebody turns off,
 * and a lock nobody turns on protects nothing.
 *
 * Signing out used to sit here too, and was the same button the settings list
 * already carries. One way out, in one place: settings owns it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import {
  Badge,
  Card,
  Chip,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  Toggle,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useStrings } from '@/i18n';
import { describeGrace, GRACE_CHOICES, useLock } from '@/lib/lock';

export default function LockSettingsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { enabled, supported, graceSeconds, setEnabled, setGraceSeconds } = useLock();

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
          <Text variant="heading">{t.lock.title}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.xl,
        }}
      >
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: theme.spacing.lg }}>
              <Text variant="subheading">{t.lock.requireBiometrics}</Text>
              <Text variant="caption" tone="muted">
                {t.lock.requireExplain}
              </Text>
            </View>
            <Toggle
              value={enabled}
              disabled={!supported}
              onValueChange={(value) => void setEnabled(value)}
              accessibilityLabel={t.lock.appLock}
            />
          </Row>
        </Card>

        {!supported ? <Badge label={t.lock.unsupported} /> : null}

        {/* Shown whether or not the app lock is on, because the number governs
            two locks and only one of them is behind that switch: the private
            personal ledger asks again after this long away regardless. Hidden
            behind `enabled`, somebody who tried "Straight away", disliked it
            and turned the app lock off would be left with a zero-second window
            on their ledger and no way back to the control that set it. Gated on
            `supported` instead, since with nothing enrolled neither lock can
            ask at all. */}
        {supported ? (
          <Card style={{ gap: theme.spacing.md }}>
            <Text variant="subheading">{t.lock.askAgainAfter}</Text>
            <Text variant="caption" tone="muted">
              {t.lock.askAgainExplain}
            </Text>
            <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {GRACE_CHOICES.map((seconds) => (
                <Chip
                  key={seconds}
                  label={describeGrace(seconds, t, locale)}
                  selected={graceSeconds === seconds}
                  onPress={() => void setGraceSeconds(seconds)}
                />
              ))}
            </Row>
            <Text variant="micro" tone="muted">
              {t.lock.reopenAlwaysAsks}
            </Text>
          </Card>
        ) : null}

        <Text variant="micro" tone="muted" align="center">
          {t.lock.footnote}
        </Text>
      </ScrollView>
    </Screen>
  );
}
