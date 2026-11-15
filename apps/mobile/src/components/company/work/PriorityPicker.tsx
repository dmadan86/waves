import { View } from 'react-native';
import type { TaskPriority } from '@waves/core';
import { SegmentedPills } from '@/components/standard/parts';
import { useStrings } from '@/i18n';

/** Normal · Urgent · Very urgent. */
export function PriorityPicker({
  value,
  onChange,
}: {
  value: TaskPriority | undefined;
  onChange: (next: TaskPriority) => void;
}) {
  const { t } = useStrings();
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
      accessibilityLabel={t.company.workPriority}
    >
      <SegmentedPills
        value={value ?? 'normal'}
        onChange={onChange}
        options={[
          { value: 'normal', label: t.company.workPrioNormal },
          { value: 'urgent', label: t.company.workPrioUrgent },
          { value: 'very_urgent', label: t.company.workPrioVeryUrgent },
        ]}
      />
    </View>
  );
}
