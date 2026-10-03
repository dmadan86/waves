/**
 * Settle up from the dashboard. Settling happens inside a group — that is where
 * the debts are — so the quick action first asks which one: the groups where
 * you owe or are owed, largest balance first, each opening that group's settle
 * screen. A person square everywhere is told so rather than shown an empty list.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { iconSize, Sheet, Text, useTheme } from '@waves/ui';

import { GroupMark } from '@/components/GroupMark';
import { SplitMoney } from '@/components/SplitMoney';
import { useStrings } from '@/i18n';
import { filterSettleCandidates, SETTLE_SEARCH_THRESHOLD } from '@/lib/settlePicker';
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
  // Re-seeds to empty on every open (`onClosed`, below) rather than carrying a
  // typed filter from the last time this sheet was up.
  const [query, setQuery] = useState('');
  const open = (id: string) => {
    onClose();
    router.push(`/group/${id}/settle`);
  };
  const showSearch = groups.length > SETTLE_SEARCH_THRESHOLD;
  const visibleGroups = showSearch ? filterSettleCandidates(groups, query) : groups;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={() => setQuery('')}
      closeLabel={t.common.close}
      title={t.homeDash.settleTitle}
      // A ceiling, the same share of the screen every other tall sheet in the
      // app caps at (the voice review's destination picker, the SMS review
      // sheets) — see `Overlay`'s `resolveSheetHeight`, which turns this into
      // points of the real window height and leaves the safe-area foot to the
      // sheet's own padding. The title above stays put; only the list below
      // scrolls, so a long one never pushes the sheet's own top off-screen.
      style={{ maxHeight: '80%' }}
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
        // `flexShrink: 1` rather than a fixed `maxHeight`: the list gives up
        // exactly the room the search field above it takes, down to whatever
        // the sheet's own 80% ceiling leaves, and scrolls inside that — never
        // pushing the sheet taller than the ceiling allows.
        <View style={{ gap: theme.spacing.sm, flexShrink: 1 }}>
          {showSearch ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.xs,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.color.border,
                backgroundColor: theme.color.surface,
              }}
            >
              <Ionicons name="search" size={iconSize.md} color={theme.color.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t.captures.assignSearch}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.captures.assignSearch}
                autoCorrect={false}
                returnKeyType="search"
                style={{ flex: 1, fontSize: 15, color: theme.color.text, paddingVertical: 6 }}
              />
            </View>
          ) : null}
          <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
            {visibleGroups.length === 0 ? (
              <Text
                variant="body"
                tone="muted"
                align="center"
                style={{ paddingVertical: theme.spacing.lg }}
              >
                {t.captures.assignNoMatch}
              </Text>
            ) : (
              visibleGroups.map((group, index) => (
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
                      // A fixed, compact row rather than padding that grows
                      // with the font: the sheet is a quick pick, not a page
                      // of its own, and a shorter row is more of the list in
                      // view at once.
                      height: ROW_HEIGHT,
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
              ))
            )}
          </ScrollView>
        </View>
      )}
    </Sheet>
  );
}

/** The group mark's disc in a row. */
const DISC = 36;
/** A compact row: the disc plus a hair of breathing room above and below. */
const ROW_HEIGHT = 52;
