import Ionicons from '@expo/vector-icons/Ionicons';
import { I18nManager, Modal, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { iconSize, MODAL_ORIENTATIONS, Text, useTheme } from '@waves/ui';

/** Where a menu's trigger sits on screen (window coordinates). */
export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SortMenuOption<K extends string> {
  key: K;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

/** The sort menu's fixed width — "~220dp" per the mockup, so the trailing-edge
 *  math below has a known box to align rather than an intrinsic one. */
const SORT_MENU_WIDTH = 220;

/** A conservative guess at the open menu's height (the title plus three rows),
 *  used only to decide whether it should flip above the trigger instead of
 *  below it — a slight overestimate costs nothing, an underestimate would open
 *  the menu off the bottom of the screen. */
const SORT_MENU_HEIGHT_ESTIMATE = 200;

/**
 * The sort dropdown — a bare corner card, WhatsApp-style, matching the app's
 * other overflow menus. One row per option with its icon; the active option
 * wears the brand ink and a trailing indicator (a direction arrow on Friends,
 * a check mark on Review).
 *
 * Anchored to the sort pill rather than a fixed spot near the top of the
 * screen: it drops directly below the pill, its trailing edge lined up with
 * the pill's own, and flips to open above the pill instead when there is not
 * enough room underneath it. Shared by Friends and Review.
 */
export function SortMenu<K extends string>({
  open,
  anchor,
  onClose,
  title,
  closeLabel,
  options,
  activeKey,
  activeIndicator,
  onPick,
}: {
  open: boolean;
  /** The sort pill it opens from; null falls back to a fixed corner. */
  anchor: MenuAnchor | null;
  onClose: () => void;
  title: string;
  closeLabel: string;
  options: readonly SortMenuOption<K>[];
  activeKey: K;
  /** The glyph on the active row's trailing edge. */
  activeIndicator: keyof typeof Ionicons.glyphMap;
  onPick: (key: K) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowW, height: windowH } = useWindowDimensions();

  const trailing = anchor
    ? I18nManager.isRTL
      ? anchor.x
      : windowW - (anchor.x + anchor.width)
    : 0;
  const openAbove =
    anchor !== null &&
    windowH - (anchor.y + anchor.height) < SORT_MENU_HEIGHT_ESTIMATE + theme.spacing.sm &&
    anchor.y > SORT_MENU_HEIGHT_ESTIMATE;
  const place = anchor
    ? {
        ...(openAbove
          ? { bottom: windowH - anchor.y + theme.spacing.sm }
          : { top: anchor.y + anchor.height + theme.spacing.sm }),
        end: Math.max(
          theme.spacing.lg,
          Math.min(trailing, windowW - SORT_MENU_WIDTH - theme.spacing.lg),
        ),
      }
    : { top: insets.top + 56, end: theme.spacing.xl };

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.12)' }}
      >
        <View
          style={{
            position: 'absolute',
            width: SORT_MENU_WIDTH,
            borderRadius: theme.radius.lg,
            ...theme.shadow.lifted,
            ...place,
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
            <Text
              variant="micro"
              tone="faint"
              style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.xs }}
            >
              {title}
            </Text>
            {options.map((option) => {
              const active = option.key === activeKey;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => onPick(option.key)}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    backgroundColor: pressed ? theme.color.surfaceMuted : 'transparent',
                  })}
                >
                  <Ionicons
                    name={option.icon}
                    size={iconSize.lg}
                    color={active ? theme.color.brand : theme.color.textMuted}
                  />
                  <Text
                    variant="body"
                    style={{ flex: 1, color: active ? theme.color.brand : theme.color.text }}
                  >
                    {option.label}
                  </Text>
                  {active ? (
                    <Ionicons name={activeIndicator} size={iconSize.md} color={theme.color.brand} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
