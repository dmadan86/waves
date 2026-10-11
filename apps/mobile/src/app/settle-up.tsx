/**
 * Settle up, as a screen: which group to settle in, the groups where you owe or
 * are owed. Home's and Friends' Settle up buttons open it. It used to be a
 * bottom sheet; a screen gives a long list the full height and a real back
 * gesture. The header is compact: back, title, a one-line prompt, and a soft
 * scene behind the far corner.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { I18nManager, Image, StyleSheet, View } from 'react-native';

import { directionalIcon, IconButton, iconSize, Screen, Text, useTheme } from '@waves/ui';

import { SettleGroupList } from '@/components/home/SettleGroupList';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useSettleCandidates } from '@/lib/useSettleCandidates';

// An existing scene, reused rather than new art: the lake and mountains.
const SCENE = require('../../assets/images/scenes/afternoon.webp');
const HEADER_HEIGHT = 104;

export default function SettleUpScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const groups = useSettleCandidates();
  const rtl = I18nManager.isRTL;
  const clear = `${theme.color.bg}00`;

  return (
    <Screen>
      <View style={{ height: HEADER_HEIGHT, justifyContent: 'center' }}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
          <Image
            source={SCENE}
            resizeMode="cover"
            style={{
              position: 'absolute',
              top: 0,
              end: 0,
              width: '62%',
              height: '100%',
              opacity: 0.4,
            }}
          />
          <LinearGradient
            colors={[theme.color.bg, clear]}
            start={{ x: rtl ? 1 : 0, y: 0 }}
            end={{ x: rtl ? 0 : 1, y: 0 }}
            style={{ position: 'absolute', top: 0, bottom: 0, end: 0, width: '62%' }}
          />
          <LinearGradient
            colors={[clear, theme.color.bg]}
            style={{ position: 'absolute', start: 0, end: 0, bottom: 0, height: 36 }}
          />
        </View>
        <View style={{ paddingHorizontal: theme.spacing.xl }}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="title" align="center">
              {t.homeDash.settleTitle}
            </Text>
            <Text variant="caption" tone="muted" align="center" style={{ marginTop: 2 }}>
              {t.homeDash.settleSubtitle}
            </Text>
          </View>
          <View style={{ position: 'absolute', start: theme.spacing.xl, top: 0 }}>
            <IconButton label={t.common.back} onPress={() => router.back()}>
              <Ionicons
                name={directionalIcon('chevron-back')}
                size={iconSize.lg}
                color={theme.color.text}
              />
            </IconButton>
          </View>
        </View>
      </View>
      <SettleGroupList groups={groups} />
    </Screen>
  );
}
