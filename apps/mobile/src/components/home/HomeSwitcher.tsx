/**
 * The switch between the dashboard's three lists — Groups, Upcoming, Activity —
 * as a pill track with the live segment filled in the brand colour, and a
 * search disc beside it that opens the full, searchable groups list.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

export function HomeSwitcher<T extends string>({
  value,
  onChange,
  segments,
  searchLabel,
  onSearch,
}: {
  value: T;
  onChange: (value: T) => void;
  segments: readonly { value: T; label: string }[];
  searchLabel: string;
  onSearch: () => void;
}) {
  const theme = useTheme();
  const track = theme.scheme === 'dark' ? theme.color.surfaceMuted : '#E9E6F7';
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <View
        accessibilityRole="tablist"
        style={{
          flex: 1,
          flexDirection: 'row',
          padding: 4,
          borderRadius: theme.radius.pill,
          backgroundColor: track,
        }}
      >
        {segments.map((segment) => {
          const active = segment.value === value;
          return (
            <Pressable
              key={segment.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(segment.value)}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                backgroundColor: active ? theme.color.brand : 'transparent',
                opacity: pressed && !active ? 0.6 : 1,
              })}
            >
              <Text
                variant="body"
                numberOfLines={1}
                style={{
                  fontWeight: active ? '700' : '500',
                  color: active ? theme.color.onBrand : theme.color.textMuted,
                }}
              >
                {segment.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={searchLabel}
        onPress={onSearch}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 46,
          height: 46,
          borderRadius: 23,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: track,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="search" size={iconSize.lg} color={theme.color.text} />
      </Pressable>
    </Row>
  );
}
