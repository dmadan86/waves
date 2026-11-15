import { useState } from 'react';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Sheet, Text, useTheme } from '@waves/ui';

import { EditTextSheet } from '@/components/EditTextSheet';
import { ListRow, SectionHeader } from '@/components/standard';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { useCompanyEntries } from '@/data/companyEntries';
import {
  departmentName,
  useDepartmentEditor,
  useDepartments,
  useSetMemberDepartment,
} from '@/data/companyDepartments';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';

/** Department picker for a member, or owner-only department management when manageOnly is set. */
export function DepartmentSheet({
  groupId,
  visible,
  onClose,
  memberId,
  departmentId,
  manageOnly = false,
}: {
  groupId: string;
  visible: boolean;
  onClose: () => void;
  memberId?: string;
  departmentId?: string | null;
  manageOnly?: boolean;
}) {
  const view = useCompanyEntries(groupId);
  const departments = useDepartments(groupId);
  const editor = useDepartmentEditor(groupId);
  const setDepartment = useSetMemberDepartment(groupId);
  const theme = useTheme();
  const { t } = useStrings();
  const { confirm } = useDialog();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id?: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = view.isOwner;
  const menuDepartment = departments.find((item) => item.id === menuId);
  const menuItems: OverflowMenuItem[] = menuDepartment
    ? [
        {
          icon: 'create-outline',
          label: t.company.departmentRename,
          onPress: () => setEditing({ id: menuDepartment.id, value: menuDepartment.name }),
        },
        {
          icon: 'trash-outline',
          label: t.company.departmentRemove,
          tone: 'danger',
          onPress: async () => {
            if (
              await confirm({
                title: t.company.departmentRemove,
                body: menuDepartment.name,
                confirmLabel: t.company.departmentRemove,
                tone: 'danger',
              })
            )
              editor.remove(menuDepartment.id);
          },
        },
      ]
    : [];
  const selected = departmentName(departments, departmentId) ? departmentId : null;

  return (
    <>
      <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={manageOnly ? t.company.departments : t.company.department} />
          {!manageOnly && memberId ? (
            <>
              <ListRow
                title={t.company.departmentNone}
                trailing={
                  !selected ? (
                    <Ionicons name="checkmark" size={20} color={theme.color.brand} />
                  ) : undefined
                }
                onPress={() =>
                  setDepartment.mutate({ memberId, departmentId: null }, { onSuccess: onClose })
                }
                divider
              />
              {departments.map((department, index) => (
                <ListRow
                  key={department.id}
                  title={department.name}
                  trailing={
                    selected === department.id ? (
                      <Ionicons name="checkmark" size={20} color={theme.color.brand} />
                    ) : undefined
                  }
                  onPress={() =>
                    setDepartment.mutate(
                      { memberId, departmentId: department.id },
                      { onSuccess: onClose },
                    )
                  }
                  divider={index < departments.length - 1 || canManage}
                />
              ))}
            </>
          ) : null}
          {canManage ? (
            <>
              {departments.map((department) => (
                <ListRow
                  key={`manage-${department.id}`}
                  title={department.name}
                  trailing={
                    <Button
                      label="⋮"
                      variant="secondary"
                      accessibilityLabel={t.company.departmentActions}
                      onPress={() => setMenuId(department.id)}
                    />
                  }
                  onPress={() => setEditing({ id: department.id, value: department.name })}
                  divider
                />
              ))}
              <Button
                label={`+ ${t.company.departmentAdd}`}
                disabled={departments.length >= 30}
                onPress={() => setEditing({ value: '' })}
              />
            </>
          ) : null}
          {!manageOnly && departments.length === 0 && !canManage ? (
            <Text variant="caption" tone="muted">
              {t.company.departmentNone}
            </Text>
          ) : null}
        </View>
      </Sheet>
      <OverflowMenu visible={menuId !== null} onClose={() => setMenuId(null)} items={menuItems} />
      <EditTextSheet
        visible={editing !== null}
        title={editing?.id ? t.company.departmentRename : t.company.departmentAdd}
        value={editing?.value ?? ''}
        maxLength={40}
        error={error}
        onClose={() => {
          setEditing(null);
          setError(null);
        }}
        onSave={(name) => {
          const ok = editing?.id ? editor.rename(editing.id, name) : !!editor.add(name);
          if (ok) {
            setEditing(null);
            setError(null);
          } else setError(t.company.departmentNameError);
        }}
      />
    </>
  );
}
