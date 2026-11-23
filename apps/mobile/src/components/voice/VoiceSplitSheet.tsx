/**
 * Who shares an expense, edited in a sheet over the voice screen instead of a
 * trip to the add-expense form. It opens on the people alone, split equally. The
 * payer is one small row that swaps the sheet to the add-expense payer editor
 * (one payer or several, each with their figure); exact (one expense only), percent and shares sit behind "Split differently" (that form's
 * own split editor, with its share preview and its "left to assign" checks from
 * `lib/expenseEdit`).
 *
 * The sheet edits a copy; Done hands back the payer, the core split params and
 * the people, and only when the split adds up.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import type { SplitParams } from '@waves/core';
import { Button, iconSize, Sheet, Text, useTheme } from '@waves/ui';

import { PayersEditor, usePayersState } from '@/components/expense/PayersEditor';
import { SplitKindSegments, SplitParticipants } from '@/components/expense/SplitEditor';
import { useGroup } from '@/data/hooks';
import { displayName, isViewer } from '@/data/types';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import {
  lineAmountFor,
  payerIssueFor,
  previewShares,
  splitIssueFor,
  splitParamsFor,
} from '@/lib/expenseEdit';
import { fillEntries, SplitKind, type SplitEntries } from '@/lib/split';
import type { SplitEdit } from '@/lib/voiceSplitPure';

export interface SplitSheetResult {
  payerId: string;
  /** Everyone who paid, with their figure against the sheet's total. */
  payers: Record<string, bigint>;
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
  initialView = 'people',
  hideExact = false,
  seedPayers,
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
  /** Open on the payer list instead of the people. */
  initialView?: 'people' | 'payer';
  /** One exact total cannot be spread over several expenses. */
  hideExact?: boolean;
  /** Who paid, when more than the seed's one payer. */
  seedPayers?: Readonly<Record<string, bigint>>;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const viewerId = useViewerId();
  const group = useGroup(groupId);
  const members = useMemo(
    () => (group.members.data ?? []).filter((member) => member.left_at === null),
    [group.members.data],
  );

  const payerState = usePayersState({
    amount,
    currency,
    seed: 'voice-payers',
    initial: new Map(
      Object.entries(seedPayers ?? (seed.payerId ? { [seed.payerId]: amount } : {})),
    ),
  });
  const payerId = [...payerState.payers.keys()][0] ?? '';
  const [view, setView] = useState(initialView);
  // A split already set another way opens its figures, so they are not hidden.
  const [advanced, setAdvanced] = useState(seed.kind !== SplitKind.Equal);
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
  const payerIssue = payerIssueFor(
    { amount, payers: new Map(payerState.payers), currency },
    t.expense,
    locale,
  );
  const ready =
    payerState.payers.size > 0 &&
    payerIssue === null &&
    participants.length > 0 &&
    issue === null &&
    preview !== null;
  const nameOf = (member: (typeof members)[number]): string =>
    isViewer(member, viewerId) ? t.voice.youLabel : displayName(member, viewerId);
  const apply = (): void => {
    onApply({
      payerId,
      payers: Object.fromEntries(payerState.payers),
      params,
      participants,
    });
    onClose();
  };

  const rowStyle = ({ pressed }: { pressed: boolean }) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.sm,
    minHeight: 48,
    opacity: pressed ? 0.6 : 1,
  });
  const payerText = payerState.many
    ? t.voiceScreen.payersPeople.replace('{count}', String(payerState.payers.size))
    : (() => {
        const sole = members.find((member) => member.id === payerId);
        return sole ? nameOf(sole) : t.voice.youLabel;
      })();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t.common.close}
      title={view === 'payer' ? t.voice.paidBy : t.voiceScreen.splitWith}
      style={{
        backgroundColor: theme.color.bg,
        paddingHorizontal: theme.spacing.xl,
        maxHeight: '85%',
      }}
    >
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
          {view === 'payer' ? (
            <>
              <PayersEditor
                members={members}
                viewerId={viewerId}
                payers={payerState.payers}
                paidText={payerState.paidText}
                manyPayers={payerState.many}
                amount={amount}
                currency={currency}
                message={payerIssue}
                onToggle={payerState.toggle}
                onEntry={payerState.entry}
                onEvenly={payerState.evenly}
                onMany={payerState.setManyPayers}
              />
              <Button
                label={t.common.done}
                variant="brand"
                disabled={payerState.payers.size === 0 || payerIssue !== null}
                onPress={() => (ready ? apply() : setView('people'))}
              />
            </>
          ) : (
            <>
              {advanced ? (
                <SplitKindSegments value={kind} onChange={setKind} allowExact={!hideExact} />
              ) : null}
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
              {payerId ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.voiceScreen.paidByName.replace('{name}', payerText)}
                  onPress={() => setView('payer')}
                  style={rowStyle}
                >
                  <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                    {t.voiceScreen.paidByName.replace('{name}', payerText)}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={iconSize.sm}
                    color={theme.color.textFaint}
                  />
                </Pressable>
              ) : null}
              {advanced ? null : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setAdvanced(true)}
                  style={rowStyle}
                >
                  <Text tone="brand" style={{ fontWeight: '600' }}>
                    {t.voiceScreen.splitDifferently}
                  </Text>
                </Pressable>
              )}
              <Button label={t.common.done} variant="brand" disabled={!ready} onPress={apply} />
            </>
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}
