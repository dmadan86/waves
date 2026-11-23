/** One date row: the date as words on the left, the platform's own picker at the end. */

import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { dateFrom, isoDate } from '@/lib/expenseDay';

export function DateField({
  text,
  value,
  label,
  onChange,
  minimumDate,
}: {
  /** The date as the reader should see it ("No date set", "June 2035"). */
  text: string;
  value: string | null;
  label: string;
  onChange: (iso: string) => void;
  minimumDate?: Date;
}) {
  const theme = useTheme();
  const shown = dateFrom(value ?? isoDate(new Date()));
  return (
    <Row style={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
      <Text variant="body">{text}</Text>
      {Platform.OS === 'ios' ? (
        <DateTimePicker
          value={shown}
          mode="date"
          display="compact"
          minimumDate={minimumDate}
          accessibilityLabel={label}
          onChange={(_event, picked) => picked && onChange(isoDate(picked))}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={8}
          style={{ minHeight: 44, justifyContent: 'center' }}
          onPress={() =>
            DateTimePickerAndroid.open({
              value: shown,
              mode: 'date',
              minimumDate,
              onChange: (event, picked) => {
                if (event.type === 'set' && picked) onChange(isoDate(picked));
              },
            })
          }
        >
          <Ionicons name="calendar-outline" size={iconSize.lg} color={theme.color.brand} />
        </Pressable>
      )}
    </Row>
  );
}
