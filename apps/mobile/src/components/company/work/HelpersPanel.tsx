/** "Also working on it" (optional): up to 5 more people besides the responsible one. Shared by the add and edit sheets. */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, iconSize, Text, useTheme } from '@waves/ui';

import { IconDisc } from '@/components/company/dashboard/overviewKit';
import { PersonAvatar } from '@/components/PersonAvatar';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { toggleHelper } from '@/lib/companyWork';

export function HelpersPanel({
  people,
  responsibleId,
  value,
  onChange,
  onDone,
}: {
  people: readonly MemberRow[];
  /** Left out of the list: they are already responsible. */
  responsibleId: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const [q, setQ] = useState('');
  const brand = theme.color.brand;
  const needle = q.trim().toLowerCase();
  const list = people.filter(
    (p) => p.id !== responsibleId && (!needle || displayName(p).toLowerCase().includes(needle)),
  );
  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconDisc ink={brand} size={48}>
          <Ionicons name="people-outline" size={iconSize.lg} color={brand} />
        </IconDisc>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="title" accessibilityRole="header" style={{ fontWeight: '800' }}>
            {t.company.taskAssignTitle}
          </Text>
          <Text variant="caption" tone="muted">
            {`${t.company.taskHelpers} · ${t.company.taskHelpersMax}`}
          </Text>
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: 44,
          paddingHorizontal: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.color.border,
        }}
      >
        <Ionicons name="search" size={iconSize.base} color={theme.color.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t.voice.searchPeopleShort}
          placeholderTextColor={theme.color.textFaint}
          accessibilityLabel={t.voice.searchPeopleShort}
          style={{ flex: 1, color: theme.color.text, paddingVertical: 8 }}
        />
      </View>
      <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ gap: 4 }}>
        {list.map((person) => {
          const on = value.includes(person.id);
          return (
            <Pressable
              key={person.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={displayName(person)}
              onPress={() => onChange(toggleHelper(value, person.id, responsibleId))}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 56,
                paddingHorizontal: 10,
                borderRadius: 12,
                backgroundColor: on ? theme.color.brandSoft : 'transparent',
              }}
            >
              <PersonAvatar
                name={displayName(person)}
                member={person}
                ghost={isGhost(person)}
                size={40}
              />
              <Text numberOfLines={1} style={{ flex: 1, fontWeight: '700' }}>
                {displayName(person)}
              </Text>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  borderWidth: on ? 0 : 1.5,
                  borderColor: theme.color.textMuted,
                  backgroundColor: on ? brand : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {on ? <Ionicons name="checkmark" size={18} color={theme.color.onBrand} /> : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {value.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            minHeight: 44,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name="people-outline" size={iconSize.base} color={theme.color.textMuted} />
          <Text style={{ flex: 1 }}>
            {plural(locale, value.length, t.pickers.peopleSelectedCount)}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange([])}
            hitSlop={12}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: brand, fontWeight: '700' }}>{t.calendar.clear}</Text>
          </Pressable>
        </View>
      ) : null}
      <Button
        label={value.length > 0 ? fill(t.company.taskAssignN, { n: value.length }) : t.common.done}
        onPress={onDone}
      />
    </View>
  );
}

/** The one-line summary shown on the form's "Also working on it" button. */
export function helpersSummary(
  people: readonly MemberRow[],
  ids: readonly string[],
  none: string,
): string {
  const names = ids.map((id) => people.find((p) => p.id === id)).filter(Boolean) as MemberRow[];
  return names.length === 0 ? none : names.map((p) => displayName(p)).join(', ');
}
