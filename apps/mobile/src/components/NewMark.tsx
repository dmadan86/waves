/**
 * The marks that point at what changed since the reader last opened a group:
 * the green of the unread dot, as a small dot before a title, a faint wash on
 * the row, and a "New" / "Edited" pill. The words are what carry the meaning —
 * the green only says where to look.
 */

import { View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { UNREAD_GREEN } from '@/components/UnreadDot';

/** The row wash: the dot's green, faint enough to keep the row's text legible
 *  on both the light and the dark surface. */
export function newTint(scheme: 'light' | 'dark'): string {
  return scheme === 'dark' ? 'rgba(34,197,94,0.16)' : 'rgba(34,197,94,0.10)';
}

/** The pill's text: a darker green on the light wash, a lighter one on dark. */
export function newInk(scheme: 'light' | 'dark'): string {
  return scheme === 'dark' ? '#4ADE80' : '#15803D';
}

/** The 7dp dot that sits before a highlighted title. */
export function NewDot(): React.JSX.Element {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: UNREAD_GREEN }}
    />
  );
}

/** A compact "New" / "Edited" pill (or a longer "Edited · by Ravi" tag). */
export function NewPill({
  label,
  onDark = false,
}: {
  label: string;
  /** On the brand-coloured hero: a solid green chip, since a wash would vanish. */
  onDark?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 999,
        backgroundColor: onDark ? UNREAD_GREEN : newTint(theme.scheme),
        borderWidth: 1,
        borderColor: UNREAD_GREEN,
      }}
    >
      <Text
        variant="micro"
        numberOfLines={1}
        style={{
          color: onDark ? '#052E16' : newInk(theme.scheme),
          fontWeight: '700',
          fontSize: 10,
          lineHeight: 14,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
