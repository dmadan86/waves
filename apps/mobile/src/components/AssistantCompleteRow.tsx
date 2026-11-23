/**
 * "Complete this expense": rows on a saved expense's detail screen that opens
 * the assistant's follow-up questions over it.
 *
 * Drawn only for a Pro person, one row per missing place or way of paying, and never on a deleted or settled-away bill. The
 * questions are the same ones asked after a voice add (`VoiceFollowUps`), so
 * skipping, muting and learning behave the same.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Sheet, useTheme } from '@waves/ui';

import { DetailRow } from '@/components/DetailRows';
import { useAgentLocalData } from '@/components/VoiceAgentPanel';
import { VoiceFollowUps } from '@/components/VoiceFollowUps';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { completeGaps, groupWriteFromRow, savedStateFromRow } from '@/lib/assistantComplete';
import type { ExpenseVersionRow } from '@/data/types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AssistantCompleteRow({
  groupId,
  expenseId,
  version,
  hasLegacyReceipt,
  isPro,
}: {
  groupId: string;
  expenseId: string;
  version: ExpenseVersionRow;
  hasLegacyReceipt: boolean;
  isPro: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const viewerId = useViewerId();
  const local = useAgentLocalData(viewerId);
  const [open, setOpen] = useState(false);
  const gaps = completeGaps(version, hasLegacyReceipt);
  const initial = useMemo(
    () => savedStateFromRow({ groupId, expenseId, version, hasLegacyReceipt }),
    [groupId, expenseId, version, hasLegacyReceipt],
  );
  const write = useMemo(() => groupWriteFromRow({ expenseId, version }), [expenseId, version]);
  if (!isPro || gaps.length === 0) return null;

  // One plain row per gap, all opening the same follow-ups. The receipt has its own
  // "Add receipt" card on the screen, so it gets no row here.
  const rows: { gap: string; icon: 'wallet-outline' | 'location-outline'; label: string }[] = [];
  for (const gap of gaps) {
    if (gap === 'payment')
      rows.push({ gap, icon: 'wallet-outline', label: t.assistant.completePaid });
    else if (gap === 'place')
      rows.push({ gap, icon: 'location-outline', label: t.assistant.completePlace });
  }
  if (rows.length === 0) return null;

  return (
    <>
      {rows.map((row) => (
        <DetailRow
          key={row.gap}
          icon={row.icon}
          label={row.label}
          value={t.assistant.completeAdd}
          onPress={() => setOpen(true)}
          accessibilityLabel={`${row.label}. ${t.assistant.completeAdd}`}
        />
      ))}
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t.assistant.completeSheetTitle}
        closeLabel={t.common.close}
      >
        <View style={{ gap: theme.spacing.md }}>
          <VoiceFollowUps
            initial={initial}
            groupWrite={write}
            local={local}
            today={todayIso()}
            onClose={() => setOpen(false)}
          />
        </View>
      </Sheet>
    </>
  );
}
