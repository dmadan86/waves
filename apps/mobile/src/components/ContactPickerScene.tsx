/**
 * The full-screen contact picker, shared by every route that browses the
 * address book: `contact-picker` (adding to a group form) and `friends/contacts`
 * (adding people to Waves). One screen, so the two cannot drift apart.
 *
 * See `app/contact-picker.tsx` for how a pushed route gets its answer back; this
 * component only draws the scene, the header and `ContactPicker`'s `compact`
 * dress, and hands the ticked people to `onConfirm`.
 */

import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { directionalIcon, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

import { ContactPicker, type PickedContact } from '@/components/ContactPicker';
import { type KnownIndex } from '@/lib/contactMatch';
import { useHeroStatusBar } from '@/components/ScreenHero';
import { router } from '@/lib/navigation';

/** The back button's own size, so the subtitle below it can line up under the
 *  title rather than under the button. */
const BACK_BUTTON = 44;

export interface ContactPickerSceneProps {
  readonly onConfirm: (people: readonly PickedContact[]) => void;
  readonly initialSelected?: readonly PickedContact[];
  readonly existing?: ReadonlySet<string>;
  readonly known?: KnownIndex;
  readonly escape?: { readonly label: string; readonly onPress: () => void };
  /** Replaces the line under the title, e.g. to say who was just added. */
  readonly subtitle?: string;
}

export function ContactPickerScene({
  onConfirm,
  initialSelected,
  existing,
  known,
  escape,
  subtitle,
}: ContactPickerSceneProps): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const insetsTop = useSafeAreaInsets().top;

  useHeroStatusBar(theme.scheme === 'dark' ? 'light' : 'dark');

  return (
    <Screen edges={['bottom']}>
      <View
        style={{
          paddingTop: insetsTop + theme.spacing.xs,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
          gap: 2,
        }}
      >
        {/* One row: the button inline with the title, not stacked above it —
            a row of its own cost the header a whole extra line of height for
            nothing the title couldn't say beside it. */}
        <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <TranslucentBackButton label={t.common.back} onPress={() => router.back()} />
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 19,
              lineHeight: 24,
              fontWeight: '800',
              color: theme.color.text,
            }}
          >
            {t.misc.fromYourContacts}
          </Text>
        </Row>
        {/* Indented under the title, not the button, and kept to the one line
            it is given — a wrap here is what the search card's ride then
            covers half of. */}
        <Text
          numberOfLines={1}
          style={{
            marginStart: BACK_BUTTON + theme.spacing.md,
            fontSize: 13,
            lineHeight: 17,
            color: theme.color.textMuted,
          }}
        >
          {subtitle ?? t.pickers.fromYourContactsSubtitle}
        </Text>
      </View>

      <View
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
        }}
      >
        <ContactPicker
          compact
          onConfirm={onConfirm}
          initialSelected={initialSelected}
          existing={existing}
          known={known}
          escape={escape}
        />
      </View>
    </Screen>
  );
}

/** The round back button every plain header wears: a hairline circle. */
export function TranslucentBackButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: BACK_BUTTON,
        height: BACK_BUTTON,
        borderRadius: BACK_BUTTON / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.surface,
        borderWidth: 1,
        borderColor: theme.color.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons
        name={directionalIcon('chevron-back')}
        size={iconSize.xl}
        color={theme.color.text}
      />
    </Pressable>
  );
}
