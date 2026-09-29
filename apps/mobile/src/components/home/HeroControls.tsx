/**
 * The controls a scenic hero wears along its top row — the face on the left,
 * bare white glyphs on the right. Shared by Home and Personal so both heroes
 * read as the same family.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, View } from 'react-native';

import { Avatar, iconSize, useTheme } from '@waves/ui';

/**
 * The face at the top of the hero. With a photo it is the ordinary Avatar; with
 * none it is a person glyph inside a ringed, *transparent* circle — the hero's
 * colour shows through rather than an initials chip on a tinted disc, so it sits
 * on the wash the way the reference's placeholder does. White glyph and ring, so
 * one treatment reads on green, teal or indigo alike.
 */
export function HeroAvatar({
  name,
  photoUrl,
  onPress,
  label,
  ink,
}: {
  name: string;
  photoUrl?: string | null;
  onPress: () => void;
  label: string;
  /** The glyph and ring colour; white by default. */
  ink?: string;
}) {
  const theme = useTheme();
  if (photoUrl) {
    return (
      <Avatar
        name={name}
        size={40}
        photoUrl={photoUrl}
        accessibilityLabel={label}
        onPress={onPress}
      />
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderColor: ink ?? 'rgba(255, 255, 255, 0.55)',
        opacity: pressed ? (ink ? 0.5 : 0.6) : ink ? 0.7 : 1,
      })}
    >
      <Ionicons name="person-outline" size={iconSize.lg} color={ink ?? theme.color.onBrand} />
    </Pressable>
  );
}

/** A bare white glyph in the hero's top-right cluster — the sync icon's
    neighbour, the overflow menu's handle. No disc, so it reads lighter than the
    action circles below. */
export function HeroIconButton({
  icon,
  label,
  onPress,
  family = 'ionicons',
  dot = false,
  ink,
}: {
  /** The glyph colour; white by default. */
  ink?: string;
  icon: string;
  label: string;
  onPress: () => void;
  /** A red dot at the glyph's shoulder: something new behind it. */
  dot?: boolean;
  /** Which glyph set `icon` names — Ionicons by default, Material for the ones
   *  Ionicons lacks (the two-people-plus "group add"). */
  family?: 'ionicons' | 'material';
}) {
  const theme = useTheme();
  const Glyph = family === 'material' ? MaterialIcons : Ionicons;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: theme.spacing.xs })}
    >
      <Glyph name={icon as never} size={iconSize.xxl} color={ink ?? theme.color.onBrand} />
      {dot ? (
        <View
          style={{
            position: 'absolute',
            top: theme.spacing.xs,
            end: theme.spacing.xs,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: '#FF3B5C',
          }}
        />
      ) : null}
    </Pressable>
  );
}
