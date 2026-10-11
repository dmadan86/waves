/**
 * The "Invite {name}?" question the Merge people screen asks once a merge has
 * landed and the person is a guest the user could bring in.
 *
 * Built from the same overlay primitive as `SettleConfirmSheet` (`Popup`), not
 * from the shared dialog, so the two questions share a face without the generic
 * dialog growing screen-specific layout. Any way out other than "Invite" (the
 * X, "Not now", the scrim, Android back) is a "not now".
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, View } from 'react-native';

import { iconSize, Popup, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

const ART_HEIGHT = 110;
const BADGE = 34;

const PURPLE: [string, string] = ['#B58CF2', '#7B55E0'];
const BLUE: [string, string] = ['#8FC0FF', '#5B7BEF'];

/** A person glyph: a head over a rounded set of shoulders. */
function Person({ size, colors }: { size: number; colors: [string, string] }) {
  const head = size * 0.5;
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <LinearGradient
        colors={colors}
        style={{ width: head, height: head, borderRadius: head / 2 }}
      />
      <LinearGradient
        colors={colors}
        style={{
          position: 'absolute',
          bottom: 0,
          width: size,
          height: size * 0.5,
          borderTopLeftRadius: size / 2,
          borderTopRightRadius: size / 2,
          borderBottomLeftRadius: size * 0.14,
          borderBottomRightRadius: size * 0.14,
        }}
      />
    </View>
  );
}

export interface InviteAfterMergeSheetProps {
  visible: boolean;
  /** Answer yes: the caller opens the invite or share flow. */
  onInvite: () => void;
  /** Any other way out. */
  onClose: () => void;
  title: string;
  body: string;
  inviteLabel: string;
  skipLabel: string;
}

export function InviteAfterMergeSheet({
  visible,
  onInvite,
  onClose,
  title,
  body,
  inviteLabel,
  skipLabel,
}: InviteAfterMergeSheetProps) {
  const theme = useTheme();
  const { t } = useStrings();

  return (
    <Popup visible={visible} onClose={onClose} closeLabel={skipLabel}>
      <View style={{ alignItems: 'center' }}>
        {/* Top-end, not top-right, so it follows the reading direction in RTL. */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: 0,
            end: 0,
            width: 32,
            height: 32,
            borderRadius: theme.radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surfaceMuted,
            zIndex: 1,
          }}
        >
          <Ionicons name="close" size={iconSize.md} color={theme.color.text} />
        </Pressable>

        {/* Decorative: the title says everything the picture does. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 220,
            height: ART_HEIGHT,
            marginTop: theme.spacing.xs,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              position: 'absolute',
              bottom: 4,
              width: 200,
              height: 78,
              borderRadius: 40,
              backgroundColor: theme.color.brandSoft,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: 6,
              width: 130,
              height: 70,
              borderRadius: 40,
              backgroundColor: theme.color.brandSoft,
            }}
          />
          <Row style={{ alignItems: 'flex-end', marginTop: 12 }}>
            <Person size={58} colors={PURPLE} />
            <View style={{ marginStart: -10 }}>
              <Person size={68} colors={BLUE} />
            </View>
          </Row>
          <View
            style={{
              position: 'absolute',
              end: 52,
              bottom: 8,
              width: BADGE,
              height: BADGE,
              borderRadius: BADGE / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.positive,
              borderWidth: 2,
              borderColor: theme.color.surface,
              ...theme.shadow.soft,
            }}
          >
            <Ionicons name="add" size={iconSize.lg} color={theme.color.onBrand} />
          </View>
          <Ionicons
            name="sparkles"
            size={14}
            color={theme.color.brand}
            style={{ position: 'absolute', top: 14, end: 34, opacity: 0.7 }}
          />
        </View>

        <Text
          variant="title"
          accessibilityRole="header"
          style={{
            fontSize: 23,
            lineHeight: 30,
            textAlign: 'center',
            marginTop: theme.spacing.sm,
          }}
        >
          {title}
        </Text>
        <Text
          variant="body"
          tone="muted"
          style={{ textAlign: 'center', marginTop: theme.spacing.xs }}
        >
          {body}
        </Text>

        <Pressable
          onPress={onInvite}
          accessibilityRole="button"
          accessibilityLabel={inviteLabel}
          style={({ pressed }) => ({
            alignSelf: 'stretch',
            marginTop: theme.spacing.lg,
            height: 48,
            borderRadius: theme.radius.pill,
            overflow: 'hidden',
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <LinearGradient
            colors={[theme.color.brand, theme.color.brandPressed]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.sm,
            }}
          >
            <Ionicons name="paper-plane-outline" size={iconSize.md} color={theme.color.onBrand} />
            <Text variant="subheading" tone="onBrand" numberOfLines={1}>
              {inviteLabel}
            </Text>
          </LinearGradient>
        </Pressable>

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={skipLabel}
          style={({ pressed }) => ({
            alignSelf: 'stretch',
            marginTop: theme.spacing.sm,
            height: 48,
            borderRadius: theme.radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
            borderWidth: 1,
            borderColor: theme.color.border,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text variant="subheading" tone="brand" numberOfLines={1}>
            {skipLabel}
          </Text>
        </Pressable>
      </View>
    </Popup>
  );
}
