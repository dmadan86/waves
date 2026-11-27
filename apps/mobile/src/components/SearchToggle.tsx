/** Search hidden behind an icon by default. `SearchField` is the open field (autofocus, clear, Cancel);
 *  `SearchToggle` is the icon that becomes that field in place, for screens with no header of their own. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { IconButton, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

export function SearchField(props: {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  placeholder: string;
  trailing?: React.ReactNode;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Row style={{ alignItems: 'center', gap: 10 }}>
      <Row
        style={{
          flex: 1,
          alignItems: 'center',
          gap: 10,
          height: 44,
          paddingHorizontal: 14,
          borderRadius: 22,
          backgroundColor: theme.color.surfaceMuted,
        }}
      >
        <Ionicons name="search" size={18} color={theme.color.textMuted} />
        <TextInput
          value={props.value}
          onChangeText={props.onChange}
          placeholder={props.placeholder}
          placeholderTextColor={theme.color.textMuted}
          accessibilityLabel={props.placeholder}
          returnKeyType="search"
          autoCorrect={false}
          autoFocus
          selectionColor={theme.color.brand}
          style={{ flex: 1, fontSize: 15, height: 40, color: theme.color.text, paddingVertical: 0 }}
        />
        {props.value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.entry.clear}
            onPress={() => props.onChange('')}
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color={theme.color.textFaint} />
          </Pressable>
        ) : null}
      </Row>
      {props.trailing}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.common.cancel}
        onPress={props.onCancel}
        hitSlop={8}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 15, color: theme.color.brand }}>{t.common.cancel}</Text>
      </Pressable>
    </Row>
  );
}

export function SearchToggle(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  if (open || props.value)
    return (
      <SearchField
        value={props.value}
        placeholder={props.placeholder}
        onChange={props.onChange}
        onCancel={() => {
          props.onChange('');
          setOpen(false);
        }}
      />
    );
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <IconButton label={props.placeholder} onPress={() => setOpen(true)}>
        <Ionicons name="search" size={iconSize.lg} color={theme.color.brand} />
      </IconButton>
    </View>
  );
}
