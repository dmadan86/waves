/**
 * Settle up from the dashboard. Settling happens inside a group — that is where
 * the debts are — so the quick action first asks which one: the groups where
 * you owe or are owed, largest balance first, each opening that group's settle
 * screen. A person square everywhere is told so rather than shown an empty list.
 */

import { Pressable, View } from 'react-native';

import { Sheet, Text, useTheme } from '@waves/ui';

import { GroupMark } from '@/components/GroupMark';
import { SplitMoney } from '@/components/SplitMoney';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export interface SettleCandidate {
  id: string;
  title: string;
  coverEmoji: string | null;
  balance: bigint;
  currency: string;
}

export function SettlePickerSheet({
  visible,
  onClose,
  groups,
}: {
  visible: boolean;
  onClose: () => void;
  groups: readonly SettleCandidate[];
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const open = (id: string) => {
    onClose();
    router.push(`/group/${id}/settle`);
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t.common.close}
      title={t.homeDash.settleTitle}
    >
      {groups.length === 0 ? (
        <Text
          variant="body"
          tone="muted"
          align="center"
          style={{ paddingVertical: theme.spacing.xl }}
        >
          {t.homeDash.settleEmpty}
        </Text>
      ) : (
        <View>
          {groups.map((group, index) => (
            <Pressable
              key={group.id}
              accessibilityRole="button"
              accessibilityLabel={group.title}
              onPress={() => open(group.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.color.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: theme.color.brandSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <GroupMark emoji={group.coverEmoji} size={22} color={theme.color.brand} />
              </View>
              <Text variant="body" numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
                {group.title}
              </Text>
              <SplitMoney
                amount={group.balance}
                currency={group.currency}
                locale={locale}
                color={group.balance > 0n ? theme.color.positive : theme.color.negative}
              />
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}
