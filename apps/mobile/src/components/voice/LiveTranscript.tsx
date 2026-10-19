/**
 * What was heard, as it is heard: the partial in a quieter ink while the mic is
 * open, the final in full ink once it stops. Only ever the recogniser's own
 * words — when there are none, nothing is drawn.
 *
 * The box keeps a two-line minimum while listening so the first word arriving
 * does not shove the suggestions down; past that it simply grows and wraps.
 * There is no per-character animation: a new partial replaces the text.
 *
 * With `onEdit`, tapping a final transcript (a small pencil says so) hands the
 * words to the typed composer, where they are corrected and sent again. There
 * is no caption: the words are the whole card.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

export function LiveTranscript({
  text,
  final,
  reserve,
  onEdit,
}: {
  text: string;
  final: boolean;
  /** Hold room for the words about to arrive (the mic is open). */
  reserve?: boolean;
  onEdit?: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const words = text.trim();
  if (!words && !reserve) return null;
  const editable = Boolean(words && final && onEdit);
  const label = editable
    ? `${t.voiceScreen.editHeard}: ${words}`
    : `${final ? t.voiceScreen.youSaid : t.voiceScreen.hearing}: ${words}`;
  return (
    <Pressable
      disabled={!editable}
      onPress={onEdit}
      accessible={Boolean(words)}
      accessibilityRole={editable ? 'button' : 'text'}
      accessibilityLabel={label}
      style={{
        alignSelf: 'stretch',
        minHeight: reserve ? 76 : words ? 48 : undefined,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: words ? theme.color.surface : 'transparent',
        ...(words ? theme.shadow.soft : null),
      }}
    >
      {words ? (
        <>
          <Text variant="body" tone={final ? 'default' : 'muted'} style={{ flex: 1 }}>
            {`“${words}”`}
          </Text>
          {editable ? (
            <Ionicons name="create-outline" size={iconSize.base} color={theme.color.brand} />
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}
