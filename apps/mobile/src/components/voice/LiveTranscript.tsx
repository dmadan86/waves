/**
 * What was heard, as it is heard: the partial in a quieter ink while the mic is
 * open, the final in full ink once it stops. Only ever the recogniser's own
 * words — when there are none, nothing is drawn.
 *
 * The box keeps a two-line minimum while listening so the first word arriving
 * does not shove the suggestions down; past that it simply grows and wraps.
 * There is no per-character animation: a new partial replaces the text.
 *
 * With `onEdit`, a final transcript carries an "Edit text" action that hands the
 * words to the typed composer, where they are corrected and sent again.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

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
  return (
    <View
      style={{
        alignSelf: 'stretch',
        minHeight: reserve ? 76 : undefined,
        gap: theme.spacing.xs,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: words ? theme.color.surface : 'transparent',
        ...(words ? theme.shadow.soft : null),
      }}
    >
      {words ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {final ? t.voiceScreen.youSaid : t.voiceScreen.hearing}
            </Text>
            {final && onEdit ? (
              <Pressable
                onPress={onEdit}
                accessibilityRole="button"
                accessibilityLabel={t.voiceScreen.editHeard}
                hitSlop={12}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  minHeight: 32,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="create-outline" size={iconSize.sm} color={theme.color.brand} />
                <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                  {t.voiceScreen.editHeard}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Text
            variant="body"
            tone={final ? 'default' : 'muted'}
            accessibilityLabel={`${final ? t.voiceScreen.youSaid : t.voiceScreen.hearing}: ${words}`}
          >
            {`“${words}”`}
          </Text>
        </>
      ) : null}
    </View>
  );
}
