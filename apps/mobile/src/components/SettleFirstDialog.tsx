/**
 * "Settle up first" — what leaving a group asks when the viewer still has a
 * balance in it (the owner's mockup).
 *
 * A centred card: the wallet illustration, the question, a lavender card that
 * carries the amount and opens settle up, and two equal doors. The server lets
 * a member leave with a balance (`leaveGroup` is a plain `left_at` write), so
 * "Leave anyway" is real; pass no `onLeaveAnyway` and the door is simply not
 * drawn, leaving "Settle up" and the scrim as the ways out.
 *
 * The parent owns `visible` and the navigation. This only reports which door
 * was taken, after which the parent closes it — nothing here navigates, so the
 * dialog cannot outlive a screen it has just sent somebody away from.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, View } from 'react-native';

import { Button, directionalIcon, iconSize, Popup, Row, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';

const ART = require('../../assets/images/settle-first-art.webp') as number;

/** The art is 1040 x 435; it is drawn at the card's width and this ratio. */
const ART_RATIO = 1040 / 435;

/** The art's own backdrop is pale lavender, so it sits on this in both themes. */
const ART_BACKDROP = '#F4F1FF';

export interface SettleFirstDialogProps {
  visible: boolean;
  /** Scrim tap, back gesture, or the close door when there is no "Leave anyway". */
  onClose: () => void;
  /** The viewer's balance, already formatted in the group currency. */
  amount: string;
  /** Both the balance card and the "Settle up" door. */
  onSettle: () => void;
  /** Omit when the server would refuse; the door is then not drawn. */
  onLeaveAnyway?: () => void;
}

export function SettleFirstDialog({
  visible,
  onClose,
  amount,
  onSettle,
  onLeaveAnyway,
}: SettleFirstDialogProps): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const g = t.group;

  return (
    <Popup
      visible={visible}
      onClose={onClose}
      closeLabel={g.settleFirstClose}
      style={{ borderRadius: 28, padding: theme.spacing.lg, maxWidth: 420 }}
    >
      <View
        style={{
          borderRadius: theme.radius.xl,
          overflow: 'hidden',
          backgroundColor: ART_BACKDROP,
          marginBottom: theme.spacing.md,
        }}
      >
        <Image
          source={ART}
          accessible={false}
          resizeMode="cover"
          style={{ width: '100%', aspectRatio: ART_RATIO }}
        />
      </View>

      <Text
        variant="title"
        accessibilityRole="header"
        style={{ textAlign: 'center', marginBottom: theme.spacing.sm }}
      >
        {g.settleFirst}
      </Text>
      <Text
        variant="body"
        tone="muted"
        style={{ textAlign: 'center', marginBottom: theme.spacing.lg }}
      >
        {g.settleFirstBody}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fill(g.settleFirstBalanceLabel, { amount })}
        onPress={onSettle}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          padding: theme.spacing.md,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.color.brandSoft,
          opacity: pressed ? 0.85 : 1,
          marginBottom: theme.spacing.lg,
        })}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: theme.radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surface,
          }}
        >
          <Ionicons name="people-outline" size={iconSize.lg} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="muted">
            {g.settleFirstBalance}
          </Text>
          <Text
            variant="heading"
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{ color: theme.color.brand }}
          >
            {amount}
          </Text>
        </View>
        <Ionicons
          // Content, not layout: RN mirrors the row in RTL, not the glyph.
          name={directionalIcon('chevron-forward')}
          size={iconSize.md}
          color={theme.color.brand}
        />
      </Pressable>

      <Row style={{ gap: theme.spacing.sm }}>
        {onLeaveAnyway ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={g.leaveAnyway}
            onPress={onLeaveAnyway}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 52,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: theme.spacing.sm,
              borderRadius: theme.radius.pill,
              borderWidth: 1.5,
              borderColor: theme.color.brand,
              backgroundColor: theme.color.surface,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              variant="subheading"
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ color: theme.color.brand }}
            >
              {g.leaveAnyway}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button
            label={g.settleFirstSettle}
            variant="brand"
            size="lg"
            fullWidth
            accessibilityLabel={g.settleFirstSettle}
            onPress={onSettle}
          />
        </View>
      </Row>
    </Popup>
  );
}
