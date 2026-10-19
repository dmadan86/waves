/**
 * The preview's Edit, past the amount and words: category and date, each one
 * row that opens its picker over the voice screen (the app's category sheet,
 * the platform date picker). Nothing here leaves the screen.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Platform, Pressable, View } from 'react-native';

import { iconSize, Sheet, Text, useTheme } from '@waves/ui';

import { CategorySheet } from '@/components/Category';
import { useStrings } from '@/i18n';

/** YYYY-MM-DD for a local calendar day. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayFromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function DetailRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: 48,
        paddingHorizontal: theme.spacing.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.sm} color={theme.color.textMuted} />
      <Text tone="muted">{label}</Text>
      <Text style={{ flex: 1, textAlign: 'right', fontWeight: '600' }} numberOfLines={1}>
        {value}
      </Text>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.textFaint} />
    </Pressable>
  );
}

export function VoiceDetailRows({
  category,
  categoryLabel,
  onCategory,
  date,
  onDate,
}: {
  category: string | null;
  categoryLabel: string | null;
  onCategory: (key: string) => void;
  /** YYYY-MM-DD; today when null. */
  date: string | null;
  onDate: (iso: string) => void;
}) {
  const { t, locale } = useStrings();
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [iosDateOpen, setIosDateOpen] = useState(false);
  const [today] = useState(() => isoDay(new Date()));
  const iso = date ?? today;
  const dateText =
    iso === today
      ? t.voice.confirmToday
      : dayFromIso(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const apply = (event: DateTimePickerEvent, picked?: Date): void => {
    if (Platform.OS === 'ios') setIosDateOpen(false);
    if (event.type === 'dismissed' || !picked) return;
    onDate(isoDay(picked));
  };
  const openDate = (): void => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: dayFromIso(iso),
        mode: 'date',
        maximumDate: new Date(),
        onChange: apply,
      });
    } else setIosDateOpen(true);
  };
  return (
    <View>
      <DetailRow
        icon="pricetag-outline"
        label={t.voiceScreen.category}
        value={categoryLabel ?? '—'}
        onPress={() => setCategoryOpen(true)}
      />
      <DetailRow
        icon="calendar-outline"
        label={t.voiceScreen.date}
        value={dateText}
        onPress={openDate}
      />
      {categoryOpen ? (
        <CategorySheet
          value={category}
          onChange={(key) => {
            onCategory(key);
            setCategoryOpen(false);
          }}
          onClose={() => setCategoryOpen(false)}
        />
      ) : null}
      {Platform.OS === 'ios' && iosDateOpen ? (
        <Sheet visible onClose={() => setIosDateOpen(false)} closeLabel={t.common.close}>
          <DateTimePicker
            value={dayFromIso(iso)}
            mode="date"
            display="inline"
            maximumDate={new Date()}
            onChange={apply}
          />
        </Sheet>
      ) : null}
    </View>
  );
}
