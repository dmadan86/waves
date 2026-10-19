/**
 * "Complete this expense": a row on a saved expense's detail screen that opens
 * the assistant's follow-up questions over it.
 *
 * Drawn only for a Pro person, only when the place, the way it was paid or a
 * receipt is missing, and never on a deleted or settled-away bill. The
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

  return (
    <>
      <DetailRow
        icon="sparkles-outline"
        iconColor={theme.color.brand}
        label={t.assistant.completeRow}
        value={t.assistant.completeRowHint}
        onPress={() => setOpen(true)}
        accessibilityLabel={`${t.assistant.completeRow}. ${t.assistant.completeRowHint}`}
      />
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
