/**
 * The sheet primitive the expense forms share, and the row a sheet's choices
 * are listed in.
 *
 * Both the capture screen and the group add-expense screen present their
 * pickers (currency, destination) as a bottom sheet over the form, and list
 * their choices as a leading glyph + label + check. Pulling them here means the
 * two screens present, dismiss, and read the same rather than each carrying its
 * own copy that could drift apart.
 *
 * This file used to also hold the row a sheet's *result* was stated in —
 * `FieldRow` (name stacked over value) and `SettingRow` (name and value on one
 * line, the shape this file was named for). Both are gone: every caller of
 * either now uses `DetailRow` from `@/components/DetailRows`, which is the
 * shape the expense screen already stated a filed bill's facts in. A field
 * asked on a form and read back on the receipt now looks like the same
 * question both times. See that file's header for the fuller reasoning and
 * for what still stays a different row (`ListRow` in `@waves/ui`, for an entry
 * you open rather than a fact you're told).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView } from 'react-native';

import { iconSize, Sheet, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

/**
 * How long to hold the sheet mounted after a dismissal, so its exit is seen.
 *
 * Every caller mounts this conditionally — `{picking ? <SheetOverlay …/> : null}`
 * — so the moment `onClose` reaches the screen the whole thing is unmounted and
 * any exit animation is lost. Rather than change seven call sites, the wrapper
 * keeps its own open flag: on dismissal it closes the sheet and tells the
 * screen a beat later, once the exit has played.
 */
const EXIT_MS = 220;

/**
 * A bottom sheet over the form: a dimmed backdrop that closes on tap, a rounded
 * card that swallows its own taps, a grab handle and a title.
 *
 * It is now a thin wrapper over `Sheet` from `@waves/ui` rather than its own
 * implementation. The old one was an absolutely-positioned layer *inside the
 * screen's own tree*, which is the root of what it had to keep working around:
 * a view inside the page is bounded by the page, so the backdrop could only
 * ever dim what its parent covered, it needed `elevation: 24` to climb over the
 * app's raised cards, and it had to ask a route-aware helper whether the app's
 * bottom bar was going to paint over it. `Sheet` is a real modal window with
 * `statusBarTranslucent` and `navigationBarTranslucent`, so its scrim covers
 * the whole display — system bars included — and nothing in the app can paint
 * above it.
 *
 * Everything the pickers had is still here: the handle, the title, tap-to-close
 * on both, drag-down-to-dismiss (now `PanResponder` inside `Sheet`, because the
 * design system carries no gesture dependency), the 75% ceiling and the
 * scrolling list under it.
 */
export function SheetOverlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();

  // Open from the first frame; `Sheet` animates its own arrival from nothing
  // whether it mounts open or is opened later.
  const [open, setOpen] = useState(true);

  // A scrim tap and a drag can both land in the same gesture; without this the
  // screen is told twice, and a caller that pops a route on close pops two.
  const dismissing = useRef(false);
  const dismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    setOpen(false);
    setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  useEffect(
    () => () => {
      dismissing.current = true;
    },
    [],
  );

  return (
    <Sheet
      visible={open}
      onClose={dismiss}
      title={title}
      closeLabel={t.common.close}
      // A ceiling rather than a height: a three-option sheet stays short, and a
      // long currency list stops well before the top of the screen.
      style={{ maxHeight: '75%' }}
    >
      {/* flexShrink lets this scroll: without it the list keeps its full
          content height and the card's maxHeight clips the overflow instead of
          scrolling it, so a long group or currency list loses its bottom rows. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ gap: theme.spacing.md }}
      >
        {children}
      </ScrollView>
    </Sheet>
  );
}

/** One row in a picker sheet — a leading glyph, a label, a check when chosen. */
export function ChoiceRow({
  leading,
  label,
  selected,
  onPress,
}: {
  leading: ReactNode;
  label: string;
  /**
   * Whether this is the chosen option. Omit for a row that is an *action*
   * rather than one of the choices — "New tag" at the foot of the category
   * sheet — so a screen reader is told it is a button and not that it is an
   * option you have not selected.
   */
  selected?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {leading}
      <Text
        variant="body"
        numberOfLines={1}
        style={{ flex: 1, color: selected ? theme.color.brand : theme.color.text }}
      >
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} /> : null}
    </Pressable>
  );
}
