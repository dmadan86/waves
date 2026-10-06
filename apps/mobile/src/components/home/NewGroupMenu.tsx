/**
 * Home's "new group" drop-down: create a group, scan an invite QR, or join with
 * a pasted link or code. Drops from the tile or button that was tapped, the
 * same anchored pattern Friends' "+ Friend" menu uses.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { I18nManager, Modal, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MODAL_ORIENTATIONS, iconSize, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { SCAN_PASTE_MODE } from '@/lib/scanMode';

/** Where the trigger sits on screen (window coordinates). */
export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MENU_WIDTH = 230;

export function NewGroupMenu({
  open,
  anchor,
  onClose,
  onCreate,
}: {
  open: boolean;
  /** The trigger it opens from; null falls back to the top corner. */
  anchor: MenuAnchor | null;
  onClose: () => void;
  /** "Create a group" — the caller owns the guest gate. */
  onCreate: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const { width: windowW } = useWindowDimensions();

  const leading = anchor ? (I18nManager.isRTL ? windowW - (anchor.x + anchor.width) : anchor.x) : 0;
  const place = anchor
    ? {
        top: anchor.y + anchor.height + theme.spacing.sm,
        start: Math.max(
          theme.spacing.lg,
          Math.min(leading, windowW - MENU_WIDTH - theme.spacing.lg),
        ),
      }
    : { top: insets.top + 56, end: theme.spacing.xl };

  const go = (path: string): void => {
    onClose();
    router.push(path as never);
  };

  const items: {
    key: string;
    label: string;
    icon: 'add-circle-outline' | 'qr-code-outline' | 'link-outline';
    onPress: () => void;
  }[] = [
    {
      key: 'create',
      label: t.homeDash.createGroup,
      icon: 'add-circle-outline',
      onPress: () => {
        onClose();
        onCreate();
      },
    },
    {
      key: 'scan',
      label: t.homeDash.scanQrCode,
      icon: 'qr-code-outline',
      onPress: () => go('/scan'),
    },
    {
      key: 'join',
      label: t.homeDash.joinLinkOrCode,
      icon: 'link-outline',
      onPress: () => go(`/scan?mode=${SCAN_PASTE_MODE}`),
    },
  ];

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t.common.close}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.12)' }}
      >
        <View
          style={{
            position: 'absolute',
            ...place,
            minWidth: MENU_WIDTH,
            borderRadius: theme.radius.lg,
            ...theme.shadow.lifted,
          }}
        >
          <View
            style={{
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: theme.color.surface,
              paddingVertical: theme.spacing.xs,
              overflow: 'hidden',
            }}
          >
            {items.map((item) => (
              <Pressable
                key={item.key}
                onPress={item.onPress}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.md,
                  backgroundColor: pressed ? theme.color.surfaceMuted : 'transparent',
                })}
              >
                <Ionicons name={item.icon} size={iconSize.lg} color={theme.color.text} />
                <Text variant="body" style={{ flex: 1 }}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
