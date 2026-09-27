/**
 * Settle up from the dashboard. Settling happens inside a group — that is where
 * the debts are — so the quick action first asks which one: the groups where
 * you owe or are owed, largest balance first, each opening that group's settle
 * screen. A person square everywhere is told so rather than shown an empty list.
 */

import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

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
  const { height } = useWindowDimensions();
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
        // Compact rows, scrolling when there are many: the sheet is a quick
        // pick, not a page of its own.
        <ScrollView style={{ maxHeight: height * 0.55 }} showsVerticalScrollIndicator={false}>
          {groups.map((group, index) => (
            <View key={group.id}>
              {index > 0 ? (
                <View
                  style={{
                    height: 1,
                    marginStart: DISC + theme.spacing.md,
                    backgroundColor: theme.color.border,
                  }}
                />
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={group.title}
                onPress={() => open(group.id)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  paddingVertical: 10,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View
                  style={{
                    width: DISC,
                    height: DISC,
                    borderRadius: DISC / 2,
                    backgroundColor: theme.color.brandSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <GroupMark emoji={group.coverEmoji} size={18} color={theme.color.brand} />
                </View>
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, fontSize: 15, fontWeight: '600', color: theme.color.text }}
                >
                  {group.title}
                </Text>
                <SplitMoney
                  amount={group.balance}
                  currency={group.currency}
                  locale={locale}
                  color={group.balance > 0n ? theme.color.positive : theme.color.negative}
                  fontSize={15}
                />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

/** The group mark's disc in a row. */
const DISC = 36;
