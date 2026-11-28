/** The one month switcher of every Personal tab root: a centred "‹ Month YYYY ›". */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';

import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

function Step({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons
        name={directionalIcon(icon)}
        size={iconSize.lg}
        color={disabled ? theme.color.textFaint : theme.color.text}
      />
    </Pressable>
  );
}

/** Disabled (not hidden) at the ends, so the month name never jumps sideways. */
export function MonthSwitcher({
  label,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  pill = false,
}: {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /** A soft brand-tinted pill with the arrows at its ends. */
  pill?: boolean;
}) {
  const theme = useTheme();
  return (
    <Row
      style={{
        alignItems: 'center',
        justifyContent: pill ? 'space-between' : 'center',
        ...(pill ? { backgroundColor: theme.color.brandSoft, borderRadius: 22 } : null),
      }}
    >
      <Step icon="chevron-back" label={prevLabel} disabled={prevDisabled} onPress={onPrev} />
      <Text
        accessibilityLiveRegion="polite"
        numberOfLines={1}
        style={{
          minWidth: 150,
          textAlign: 'center',
          fontSize: pill ? 18 : 16,
          fontWeight: pill ? '800' : '700',
        }}
      >
        {label}
      </Text>
      <Step icon="chevron-forward" label={nextLabel} disabled={nextDisabled} onPress={onNext} />
    </Row>
  );
}
