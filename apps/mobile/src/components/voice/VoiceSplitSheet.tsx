/**
 * Who paid and how it splits, edited in a sheet over the voice screen instead
 * of a trip to the add-expense form. It is that form's own split editor
 * (`SplitKindSegments` + `SplitParticipants`, with its share preview and its
 * "left to assign" checks from `lib/expenseEdit`), plus one row of payer chips.
 *
 * The sheet edits a copy; Done hands back the payer, the core split params and
 * the people, and only when the split adds up.
 */

import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import type { SplitParams } from '@waves/core';
import { Button, Chip, Row, Sheet, Text, useTheme } from '@waves/ui';

import { SplitKindSegments, SplitParticipants } from '@/components/expense/SplitEditor';
import { useGroup } from '@/data/hooks';
import { displayName, isViewer } from '@/data/types';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { lineAmountFor, previewShares, splitIssueFor, splitParamsFor } from '@/lib/expenseEdit';
import { fillEntries, SplitKind, type SplitEntries } from '@/lib/split';
import type { SplitEdit } from '@/lib/voiceSplitPure';

export interface SplitSheetResult {
  payerId: string;
  params: SplitParams;
  participants: string[];
}

export function VoiceSplitSheet({
  visible,
  onClose,
  groupId,
  currency,
  amount,
  seed,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  currency: string;
  /** The expense total, minor units. */
  amount: bigint;
  /** What the sheet opens on. */
  seed: SplitEdit;
  onApply: (result: SplitSheetResult) => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const viewerId = useViewerId();
  const group = useGroup(groupId);
  const members = useMemo(
    () => (group.members.data ?? []).filter((member) => member.left_at === null),
    [group.members.data],
  );

  const [payerId, setPayerId] = useState(seed.payerId);
  const [kind, setKind] = useState<SplitKind>(seed.kind);
  const [participants, setParticipants] = useState<string[]>([...seed.participants]);
  const [weights, setWeights] = useState<SplitEntries>(
    seed.kind === SplitKind.Shares ? seed.entries : {},
  );
  const [percents, setPercents] = useState<SplitEntries>(
    seed.kind === SplitKind.Percent ? seed.entries : {},
  );
  const [exacts, setExacts] = useState<SplitEntries>(
    seed.kind === SplitKind.Exact ? seed.entries : {},
  );

  // A weighted kind opens on something valid for whoever has no entry yet.
  if (kind === SplitKind.Shares) {
    const filled = fillEntries('shares', weights, participants);
    if (filled) setWeights(filled);
  } else if (kind === SplitKind.Percent) {
    const filled = fillEntries('percent', percents, participants);
    if (filled) setPercents(filled);
  }

  const params = splitParamsFor({
    splitKind: kind,
    weights,
    percents,
    exacts,
    participants,
    currency,
  });
  const preview = previewShares({ amount, currency, params, participants, seed: 'voice-split' });
  const issue = splitIssueFor(
    { splitKind: kind, weights, percents, exacts, participants, currency, amount },
    t.expense,
    locale,
  );
  const entries =
    kind === SplitKind.Shares ? weights : kind === SplitKind.Exact ? exacts : percents;
  const setEntry = (memberId: string, text: string): void => {
    const write =
      kind === SplitKind.Shares ? setWeights : kind === SplitKind.Exact ? setExacts : setPercents;
    write((current) => ({ ...current, [memberId]: text }));
  };
  const toggle = (memberId: string): void =>
    setParticipants((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    );
  const ready = Boolean(payerId) && participants.length > 0 && issue === null && preview !== null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t.common.close}
      title={t.voiceScreen.splitSheetTitle}
      style={{
        backgroundColor: theme.color.bg,
        paddingHorizontal: theme.spacing.xl,
        maxHeight: '85%',
      }}
    >
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="caption" tone="muted">
              {t.voice.paidBy}
            </Text>
            <Row gap={theme.spacing.xs} style={{ flexWrap: 'wrap' }}>
              {members.map((member) => (
                <Chip
                  key={member.id}
                  label={
                    isViewer(member, viewerId) ? t.voice.youLabel : displayName(member, viewerId)
                  }
                  selected={payerId === member.id}
                  variant="brand"
                  onPress={() => setPayerId(member.id)}
                />
              ))}
            </Row>
          </View>
          <SplitKindSegments value={kind} onChange={setKind} />
          <SplitParticipants
            members={members}
            viewerId={viewerId}
            participants={participants}
            onToggle={toggle}
            splitKind={kind}
            entries={entries}
            onEntryChange={setEntry}
            currency={currency}
            amount={amount}
            lineAmount={(memberId) =>
              lineAmountFor(memberId, preview, { splitKind: kind, percents, amount })
            }
            splitIssue={issue}
          />
          <Button
            label={t.common.done}
            variant="brand"
            disabled={!ready}
            onPress={() => {
              onApply({ payerId, params, participants });
              onClose();
            }}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}
