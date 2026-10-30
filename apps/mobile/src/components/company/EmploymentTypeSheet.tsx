import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Sheet, useTheme } from '@waves/ui';

import { ListRow, SectionHeader } from '@/components/standard';
import { asEmploymentType, EMPLOYMENT_TYPES, type EmploymentType } from '@/data/companyPeople';
import { useSetEmploymentType } from '@/data/hooks';
import { useStrings } from '@/i18n';

export function useEmploymentTypeLabel(): (type: string | null | undefined) => string | undefined {
  const { t } = useStrings();
  const labels: Record<EmploymentType, string> = {
    full_time: t.company.empTypeFullTime,
    part_time: t.company.empTypePartTime,
    contractor: t.company.empTypeContractor,
  };
  return (type) => {
    const known = asEmploymentType(type);
    return known ? labels[known] : undefined;
  };
}

/** Picker for one employee's employment type (owner, or the employee's manager). */
export function EmploymentTypeSheet({
  groupId,
  memberId,
  current,
  visible,
  onClose,
}: {
  groupId: string;
  memberId: string;
  current: string | null | undefined;
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const label = useEmploymentTypeLabel();
  const set = useSetEmploymentType(groupId);
  const selected = asEmploymentType(current);
  const options: (EmploymentType | null)[] = [null, ...EMPLOYMENT_TYPES];
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.sm }}>
        <SectionHeader title={t.company.employmentType} />
        {options.map((type, i) => (
          <ListRow
            key={type ?? 'none'}
            title={label(type) ?? t.company.empTypeNone}
            trailing={
              selected === type ? (
                <Ionicons name="checkmark" size={20} color={theme.color.brand} />
              ) : undefined
            }
            onPress={() =>
              set.mutate({ memberId, employmentType: type }, { onSuccess: onClose })
            }
            divider={i < options.length - 1}
          />
        ))}
      </View>
    </Sheet>
  );
}
