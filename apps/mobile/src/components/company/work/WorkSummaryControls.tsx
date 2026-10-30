import { TextInput, View } from 'react-native';
import { Button, Text, useTheme } from '@waves/ui';
import { StandardCard } from '@/components/standard';
import { useStrings } from '@/i18n';

export function WorkStatTiles({
  counts,
}: {
  counts: { total: number; done: number; doing: number; pending: number };
}) {
  const { t } = useStrings();
  return (
    <StandardCard style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {[
        [t.company.workTotal, counts.total],
        [t.company.workCompleted, counts.done],
        [t.company.workInProgress, counts.doing],
        [t.company.workPending, counts.pending],
      ].map(([label, value]) => (
        <View key={String(label)}>
          <Text variant="caption" tone="muted">
            {label}
          </Text>
          <Text variant="title">{value}</Text>
        </View>
      ))}
    </StandardCard>
  );
}

export function WorkSearchControl({
  query,
  onQueryChange,
  onFilter,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onFilter: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
      <TextInput
        value={query}
        onChangeText={onQueryChange}
        placeholder={t.company.workSearch}
        placeholderTextColor={theme.color.textFaint}
        style={{
          flex: 1,
          color: theme.color.text,
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.md,
        }}
      />
      <Button
        label="☷"
        accessibilityLabel={t.company.workFilter}
        variant="secondary"
        onPress={onFilter}
      />
    </View>
  );
}
