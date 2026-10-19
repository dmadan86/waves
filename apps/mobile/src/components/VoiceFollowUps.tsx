/**
 * After the advanced voice agent saves an expense, a short, optional chain of
 * follow-up questions that enrich it, in the same panel: "Added ₹8,000 to
 * Personal ✓ — Where was this?" with one-tap answers.
 *
 * What to ask, and when to stop, is decided in core (`followUps.ts`): a
 * deterministic scorer, at most two questions, one at a time, none for small
 * spends, none for what is already filled, and it stops after two skips in a
 * row. This component only renders the question the scorer picks and writes the
 * answer through the same hooks the rest of the app writes with. It only ever
 * mounts inside `VoiceAgentPanel`, so it exists exactly where the agent does.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import {
  Frequency,
  advanceSession,
  dedupeFilled,
  encodeLoan,
  encodeRecurring,
  format,
  markWrapUpShown,
  materialiseExpenses,
  materialiseGroups,
  materialiseMembers,
  money,
  muteKind,
  nextFollowUp,
  nextMonthlyDate,
  recordAnswer,
  recordSkip,
  scheduleFor,
  NEW_SESSION,
  type FilledKind,
  type FollowUpEnvironment,
  type FollowUpKind,
  type FollowUpQuestion,
  type FollowUpSession,
} from '@waves/core';
import { Button, iconSize, Text, useTheme } from '@waves/ui';

import { VoiceTypedAnswer } from '@/components/VoiceTypedAnswer';
import { useDeleteExpense, useOpenReceipts, useWriteExpense } from '@/data/hooks';
import {
  usePersonalLedger,
  useDeletePersonalRecord,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { isViewer, type ExpenseRow, type GroupRow, type MemberRow } from '@/data/types';
import { fill, useStrings, type UiStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import {
  applyAnswer,
  deviceCurrencyFor,
  factsFor,
  filledBy,
  paymentChoices,
  planUpdate,
  toGroupWrite,
  toPersonalData,
  type FollowUpAnswer,
  type SavedState,
} from '@/lib/followUpApply';
import {
  buildFollowUpHistory,
  type FollowUpHistory,
  type HistoryGroup,
} from '@/lib/followUpHistory';
import { useFollowUpPrefs } from '@/lib/followUpPrefs';
import { currentPlaceIfGranted } from '@/lib/location';
import { router } from '@/lib/navigation';
import { useToast } from '@/lib/toast';
import { sendVoiceTranscript } from '@/lib/voiceAgent';
import { encodeAgentSplitParams } from '@/lib/voiceAgentHandoff';
import type { AgentExpenseWrite, AgentLocalData } from '@/lib/voiceAgentPlan';
import { findSplittableReceipt, handoverFor, itemizeParams } from '@/lib/splitByItem';
import { handoverKey } from '@/lib/handover';
import { syncEngine, useSync } from '@/sync';

export interface VoiceFollowUpsProps {
  initial: SavedState;
  /** The group write the expense was saved with; null for a personal one. */
  groupWrite: AgentExpenseWrite | null;
  local: AgentLocalData;
  today: string;
  onClose: () => void;
}

interface Chip {
  readonly label: string;
  readonly onPress: () => void;
  readonly primary?: boolean;
}

/** Rows from the local mirror, shaped for the pure history builder. Read once. */
function useHistorySnapshot(
  viewerId: string | null,
  excludeId: string,
  nowMs: number,
): FollowUpHistory {
  const { mirror, queue } = useSync();
  const ledger = usePersonalLedger();
  const [history] = useState<FollowUpHistory>(() => {
    const groups: HistoryGroup[] = [];
    for (const group of materialiseGroups(mirror, queue) as unknown as GroupRow[]) {
      const members = (
        materialiseMembers(mirror, queue, { groupId: group.id }) as unknown as MemberRow[]
      ).filter((m) => m.left_at === null);
      const expenses: HistoryGroup['expenses'][number][] = [];
      for (const raw of materialiseExpenses(mirror, queue, { groupId: group.id })) {
        const expense = raw as unknown as ExpenseRow;
        const v = expense.currentVersion;
        if (expense.deleted_at || !v) continue;
        let amount = 0n;
        try {
          amount = BigInt(v.amount);
        } catch {
          continue;
        }
        expenses.push({
          id: expense.id,
          authorMemberId: v.author_member_id,
          createdMs: Date.parse(v.created_at || expense.created_at) || 0,
          amountMinor: amount,
          currency: v.currency,
          category: v.category,
          description: v.description,
          date: v.expense_date,
          place: v.location?.name?.trim() || null,
          coords: v.location ? { lat: v.location.lat, lng: v.location.lng } : null,
          participantIds: v.shares.map((s) => s.member_id),
        });
      }
      groups.push({
        id: group.id,
        name: group.name?.trim() || '',
        type: String(group.type),
        startDate: group.start_date,
        endDate: group.end_date,
        archived: group.archived_at !== null,
        members: members.map((m) => ({
          id: m.id,
          name: m.profile?.display_name ?? m.ghost_name ?? '',
          isMe: isViewer(m, viewerId),
        })),
        expenses,
      });
    }
    return buildFollowUpHistory({
      groups,
      personal: ledger.txns
        .filter((txn) => txn.kind === 'expense' && txn.id !== excludeId)
        .map((txn) => ({
          amountMinor: txn.amount,
          currency: txn.currency,
          category: txn.category,
          note: txn.note,
          date: txn.date,
          place: txn.place ?? null,
        })),
      recurringNotes: ledger.recurrings.map((rule) => rule.note ?? ''),
      nowMs,
      excludeExpenseId: excludeId,
    });
  });
  return history;
}

export function VoiceFollowUps({
  initial,
  groupWrite,
  local,
  today,
  onClose,
}: VoiceFollowUpsProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const f = t.followUps;
  const toast = useToast();
  const viewerId = useViewerId();
  const prefsHandle = useFollowUpPrefs(viewerId);
  const { prefs } = prefsHandle;

  const [nowMs] = useState(() => Date.now());
  const history = useHistorySnapshot(viewerId, initial.id, nowMs);

  const upsert = useUpsertPersonalRecord();
  const removePersonal = useDeletePersonalRecord();
  const writeExpense = useWriteExpense(initial.groupId ?? '');
  const removeExpense = useDeleteExpense(initial.groupId ?? '');

  const [saved, setSaved] = useState<SavedState>(initial);
  // A bill already scanned for this group with the same total and its lines read:
  // the only case "Split by item" is offered.
  const openReceipts = useOpenReceipts(initial.kind === 'group' ? (initial.groupId ?? '') : '');
  const [session, setSession] = useState<FollowUpSession>(NEW_SESSION);
  const [filled, setFilled] = useState<FilledKind[]>([]);
  const [env, setEnv] = useState<FollowUpEnvironment | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);

  // Where the phone is — only when permission was already granted; nothing here prompts.
  useEffect(() => {
    let live = true;
    void currentPlaceIfGranted().then((place) => {
      if (!live) return;
      if (place) setHere({ lat: place.lat, lng: place.lng });
      setEnv({
        currentPlace: place?.name ?? null,
        deviceCurrency: place ? deviceCurrencyFor(place.countryCode, initial.currency) : null,
        hour: new Date().getHours(),
        nowMs: Date.now(),
        today,
      });
    });
    return () => {
      live = false;
    };
  }, [initial.currency, today]);

  const group = useMemo(
    () => local.groups.find((g) => g.id === saved.groupId) ?? null,
    [local.groups, saved.groupId],
  );
  const myMemberId = group?.members.find((m) => m.isViewer)?.id ?? null;
  const payerMemberId = saved.payers ? (Object.keys(saved.payers)[0] ?? null) : null;

  const question: FollowUpQuestion | null = useMemo(() => {
    if (!env || !prefsHandle.ready || handedOff) return null;
    return nextFollowUp({
      expense: factsFor(
        saved,
        group
          ? {
              name: group.name,
              members: group.members.map((m) => ({ id: m.id, name: m.name, isMe: m.isViewer })),
            }
          : null,
        payerMemberId,
        myMemberId,
      ),
      history: history.stats,
      prefs,
      session,
      env,
    });
  }, [
    env,
    prefsHandle.ready,
    handedOff,
    saved,
    group,
    payerMemberId,
    myMemberId,
    history,
    prefs,
    session,
  ]);

  // The trip wrap-up is asked once per group, so it is marked the moment it shows.
  useEffect(() => {
    if (question?.kind === 'wrapup' && saved.groupId) {
      const id = saved.groupId;
      prefsHandle.update((p) => markWrapUpShown(p, id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.kind]);

  const ready = env !== null && prefsHandle.ready;
  const finished = ready && question === null;

  // Nothing worth asking at all: carry on exactly as before follow-ups existed.
  useEffect(() => {
    if (finished && session.asked.length === 0 && filled.length === 0 && !handedOff) {
      toast.show(t.voice.agentDone);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const splittable =
    saved.kind === 'group' ? findSplittableReceipt(openReceipts.data, saved.amount) : null;
  const category = saved.category;
  const amountLabel = format(money(saved.amount, saved.currency), { locale });
  const whereLabel = saved.kind === 'group' ? (group?.name ?? '') : f.wherePersonal;
  const categoryLabel = (id: string): string => (t.categories as Record<string, string>)[id] ?? id;

  // ── answering ────────────────────────────────────────────────────────────

  const persist = useCallback(
    async (next: SavedState): Promise<boolean> => {
      setBusy(true);
      try {
        if (next.kind === 'personal') {
          await upsert.mutateAsync({
            recordId: next.id,
            recordKind: 'txn',
            data: toPersonalData(next),
          });
        } else if (groupWrite) {
          await writeExpense.mutateAsync(toGroupWrite(groupWrite, next));
        }
        setSaved(next);
        return true;
      } catch {
        setNotice(f.couldNotSave);
        return false;
      } finally {
        setBusy(false);
      }
    },
    // The mutation hooks are stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupWrite, f.couldNotSave],
  );

  const respond = (
    kind: FollowUpKind,
    outcome: 'answered' | 'skipped' | 'dismissed' | 'done',
  ): void => {
    setNotice(null);
    setTyping(false);
    setSession((s) => advanceSession(s, kind, outcome));
    if (outcome === 'answered') prefsHandle.update((p) => recordAnswer(p, kind, category));
    else if (outcome === 'skipped') prefsHandle.update((p) => recordSkip(p, kind, category));
  };

  const answerWith = async (q: FollowUpKind, answer: FollowUpAnswer): Promise<void> => {
    if (busy) return;
    if (await persist(applyAnswer(saved, answer))) {
      setFilled((list) => [...list, filledBy(answer)]);
      respond(q, 'answered');
    }
  };

  /** Leave for another screen (a receipt, a split in a group, settling up). */
  const handOff = (kind: FollowUpKind, go: () => void): void => {
    respond(kind, 'answered');
    setHandedOff(true);
    go();
  };

  const addExpenseParams = (
    targetGroupId: string,
    paidBy: string | null,
    split: { memberId: string }[] | null,
  ) => ({
    id: targetGroupId,
    amount: saved.amount.toString(),
    currency: saved.currency,
    description: saved.description,
    ...(saved.category ? { category: saved.category } : {}),
    expenseDate: saved.date,
    ...encodeAgentSplitParams({
      paidByMemberId: paidBy,
      split: split ? { mode: 'equal', shares: split } : null,
    }),
    ...(saved.kind === 'personal' ? { movePersonal: saved.id } : {}),
    quick: '1',
  });

  const myMemberIn = (groupId: string): string | null =>
    local.groups.find((g) => g.id === groupId)?.members.find((m) => m.isViewer)?.id ?? null;

  const submitTyped = async (text: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await sendVoiceTranscript({
      transcript: text,
      groupId: saved.groupId,
      locale,
      today,
      savedExpense: {
        id: saved.id,
        kind: saved.kind,
        groupId: saved.groupId,
        ...(question
          ? { question: questionText(question, f, { saved, group, amountLabel, categoryLabel }) }
          : {}),
      },
    });
    setBusy(false);
    const update = result.kind === 'ok' ? result.response.update : undefined;
    if (!update || update.expenseId !== saved.id) {
      setNotice(f.couldNotUse);
      return;
    }
    const plan = planUpdate(update, saved);
    let next = saved;
    for (const answer of plan.answers) next = applyAnswer(next, answer);
    if (plan.answers.length > 0) {
      if (!(await persist(next))) return;
      setFilled((list) => [...list, ...plan.answers.map(filledBy)]);
    }
    setTyping(false);
    if (question) respond(question.kind, 'answered');
    if (plan.wantsReceipt && saved.groupId) {
      setHandedOff(true);
      router.push(`/group/${saved.groupId}/expense/${saved.id}`);
    } else if (plan.splitWith) {
      const gid = plan.splitWith.groupId;
      setHandedOff(true);
      router.push({
        pathname: '/group/[id]/add-expense',
        params: addExpenseParams(gid, myMemberIn(gid), [
          ...(myMemberIn(gid) ? [{ memberId: myMemberIn(gid) as string }] : []),
          ...plan.splitWith.memberIds.map((memberId) => ({ memberId })),
        ]),
      });
    } else {
      setNotice(f.gotIt);
    }
  };

  // ── per-question chips ───────────────────────────────────────────────────

  const chipsFor = (q: FollowUpQuestion): Chip[] => {
    const no = (label = f.no): Chip => ({ label, onPress: () => respond(q.kind, 'skipped') });
    const yes = (label: string, run: () => void | Promise<void>): Chip => ({
      label,
      primary: true,
      onPress: () => void run(),
    });
    switch (q.kind) {
      case 'place':
        return [
          ...q.places.map((name, index) =>
            yes(name, () =>
              answerWith('place', {
                kind: 'place',
                name,
                coords: index === 0 && q.hereNow ? (here ?? undefined) : history.placeCoords[name],
              }),
            ),
          ),
          { label: f.placeElse, onPress: () => setTyping(true) },
        ];
      case 'receipt':
        return [
          yes(f.receiptScan, () =>
            handOff('receipt', () => router.push(`/group/${saved.groupId}/expense/${saved.id}`)),
          ),
          yes(f.receiptPick, () =>
            handOff('receipt', () => router.push(`/group/${saved.groupId}/expense/${saved.id}`)),
          ),
          ...(splittable && saved.groupId
            ? [
                yes(f.splitByItem, () => {
                  const groupId = saved.groupId as string;
                  handOff('receipt', () => {
                    void syncEngine.saveDraft(handoverKey(groupId), handoverFor(splittable));
                    router.push({
                      pathname: '/group/[id]/itemize',
                      params: itemizeParams(groupId, saved.id),
                    });
                  });
                }),
              ]
            : []),
          no(),
        ];
      case 'split':
        return [
          ...q.partners.map((partner) =>
            yes(partner.name, () =>
              handOff('split', () => {
                const me = myMemberIn(partner.groupId);
                router.push({
                  pathname: '/group/[id]/add-expense',
                  params: addExpenseParams(partner.groupId, me, [
                    ...(me ? [{ memberId: me }] : []),
                    { memberId: partner.memberId },
                  ]),
                });
              }),
            ),
          ),
          { label: f.splitSomeone, onPress: () => setTyping(true) },
          no(),
        ];
      case 'payment':
        return [
          ...paymentChoices(saved.kind).map((method) =>
            yes(paymentLabel(method, f), () => answerWith('payment', { kind: 'payment', method })),
          ),
        ];
      case 'trip': {
        const trip = q.trip;
        if (!trip) return [no()];
        return [
          yes(fill(f.tripMove, { trip: trip.name }), () =>
            handOff('trip', () =>
              router.push({
                pathname: '/group/[id]/add-expense',
                params: addExpenseParams(trip.groupId, myMemberIn(trip.groupId), null),
              }),
            ),
          ),
          no(f.tripNo),
        ];
      }
      case 'attendance':
        return [
          yes(f.attendanceEveryone, () => respond('attendance', 'answered')),
          yes(f.attendancePick, () =>
            handOff('attendance', () =>
              router.push({
                pathname: '/group/[id]/add-expense',
                params: { id: saved.groupId ?? '', expenseId: saved.id },
              }),
            ),
          ),
        ];
      case 'payer': {
        const payer = q.payer;
        if (!payer) return [no()];
        return [
          yes(fill(f.payerYes, { name: firstName(payer.name) }), () =>
            answerWith('payer', { kind: 'payer', memberId: payer.id }),
          ),
          no(f.payerNo),
        ];
      }
      case 'recurring':
        return [
          yes(f.recurringYes, async () => {
            setBusy(true);
            try {
              await upsert.mutateAsync({
                recordKind: 'recurring',
                data: encodeRecurring({
                  txnKind: 'expense',
                  amount: saved.amount,
                  currency: saved.currency,
                  category: saved.category,
                  note: saved.description,
                  ...scheduleFor(Frequency.Monthly),
                  anchorDate: saved.date,
                  nextDate: nextMonthlyDate(saved.date),
                  endDate: null,
                  // A reminder, not a silent debit: the person confirms each month.
                  autoPost: false,
                  active: true,
                }),
              });
              setFilled((list) => [...list, 'recurring']);
              respond('recurring', 'answered');
            } catch {
              setNotice(f.couldNotSave);
            } finally {
              setBusy(false);
            }
          }),
          no(),
        ];
      case 'duplicate':
        return [
          yes(f.duplicateSame, async () => {
            setBusy(true);
            try {
              await removeExpense.mutateAsync(saved.id);
              setFilled((list) => [...list, 'duplicate']);
              respond('duplicate', 'answered');
              // The expense is gone: there is nothing left to ask about.
              setSession((s) => ({ ...s, stopped: true }));
              setNotice(f.removedDuplicate);
            } catch {
              setNotice(f.couldNotSave);
            } finally {
              setBusy(false);
            }
          }),
          { label: f.duplicateDifferent, onPress: () => respond('duplicate', 'answered') },
        ];
      case 'currency': {
        const code = q.currency ?? saved.currency;
        return [
          yes(code, () => answerWith('currency', { kind: 'currency', currency: code })),
          no(fill(f.currencyKeep, { currency: saved.currency })),
        ];
      }
      case 'category':
        return [
          ...(q.categories ?? []).map((id) =>
            yes(categoryLabel(id), () =>
              answerWith('category', { kind: 'category', category: id }),
            ),
          ),
        ];
      case 'date':
        return [
          yes(f.dateYes, () =>
            answerWith('date', { kind: 'date', date: q.suggestedDate ?? saved.date }),
          ),
          { label: f.dateNo, onPress: () => respond('date', 'answered') },
        ];
      case 'lend': {
        const person = q.person ?? '';
        return [
          yes(fill(f.lendYes, { name: person }), async () => {
            setBusy(true);
            try {
              // Money lent is not money spent: it becomes a loan and leaves the expenses.
              await upsert.mutateAsync({
                recordKind: 'loan',
                data: encodeLoan({
                  direction: 'lent',
                  counterpart: person,
                  principal: saved.amount,
                  currency: saved.currency,
                  note: null,
                  startDate: saved.date,
                  status: 'active',
                }),
              });
              await removePersonal.mutateAsync(saved.id);
              setFilled((list) => [...list, 'lend']);
              respond('lend', 'answered');
              setSession((s) => ({ ...s, stopped: true }));
            } catch {
              setNotice(f.couldNotSave);
            } finally {
              setBusy(false);
            }
          }),
          { label: f.lendNo, onPress: () => respond('lend', 'answered') },
        ];
      }
      case 'wrapup':
        return [
          yes(f.wrapupYes, () =>
            handOff('wrapup', () => router.push(`/group/${saved.groupId}/settle`)),
          ),
          no(f.wrapupNo),
        ];
      case 'work':
        return [yes(f.workYes, () => answerWith('work', { kind: 'work' })), no()];
    }
  };

  // ── render ───────────────────────────────────────────────────────────────

  const items = dedupeFilled(filled)
    .map((kind) => itemLabel(kind, f))
    .filter(Boolean);
  const summary = items.length > 0 ? fill(f.savedWith, { items: items.join(' + ') }) : f.saved;

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text variant="subheading">{fill(f.added, { amount: amountLabel, where: whereLabel })}</Text>

      {question ? (
        <View
          style={{
            gap: theme.spacing.sm,
            padding: theme.spacing.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Text>{questionText(question, f, { saved, group, amountLabel, categoryLabel })}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            {chipsFor(question).map((chip) => (
              <Pressable
                key={chip.label}
                accessibilityRole="button"
                accessibilityLabel={chip.label}
                disabled={busy}
                onPress={chip.onPress}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.spacing.md,
                  height: 36,
                  justifyContent: 'center',
                  borderRadius: theme.radius.pill,
                  backgroundColor: chip.primary ? theme.color.brandSoft : theme.color.bg,
                  borderWidth: 1,
                  borderColor: chip.primary ? theme.color.brand : theme.color.border,
                  opacity: busy ? 0.5 : pressed ? 0.7 : 1,
                })}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: chip.primary ? theme.color.brand : theme.color.text,
                    fontWeight: '700',
                  }}
                >
                  {chip.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {typing ? <VoiceTypedAnswer onSubmit={(text) => void submitTyped(text)} /> : null}
          {notice ? (
            <Text variant="caption" tone="muted">
              {notice}
            </Text>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: theme.spacing.xs,
            }}
          >
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <SmallLink label={f.skip} onPress={() => respond(question.kind, 'skipped')} />
              {!typing ? <SmallLink label={f.typeInstead} onPress={() => setTyping(true)} /> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <SmallLink
                label={f.dontAsk}
                faint
                onPress={() => {
                  prefsHandle.update((p) => muteKind(p, question.kind));
                  respond(question.kind, 'dismissed');
                }}
              />
              <SmallLink
                label={f.done}
                onPress={() => setSession((s) => ({ ...s, stopped: true }))}
              />
            </View>
          </View>
        </View>
      ) : null}

      {finished && (session.asked.length > 0 || filled.length > 0 || handedOff) ? (
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
            <Ionicons name="checkmark-circle" size={iconSize.base} color={theme.color.brand} />
            <Text tone="muted">{handedOff && filled.length === 0 ? f.handedOff : summary}</Text>
          </View>
          {notice ? (
            <Text variant="caption" tone="muted">
              {notice}
            </Text>
          ) : null}
          <Button label={f.done} onPress={onClose} />
        </View>
      ) : null}

      {!ready ? <Button label={f.done} variant="secondary" onPress={onClose} /> : null}
    </View>
  );
}

function SmallLink({
  label,
  onPress,
  faint = false,
}: {
  label: string;
  onPress: () => void;
  faint?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Text
        variant="micro"
        style={{ color: faint ? theme.color.textFaint : theme.color.textMuted }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

function paymentLabel(method: string, f: UiStrings['followUps']): string {
  switch (method) {
    case 'cash':
      return f.payCash;
    case 'upi':
      return f.payUpi;
    case 'card':
      return f.payCard;
    case 'credit':
      return f.payCredit;
    case 'debit':
      return f.payDebit;
    default:
      return method;
  }
}

function itemLabel(kind: FilledKind, f: UiStrings['followUps']): string {
  switch (kind) {
    case 'place':
      return f.itemPlace;
    case 'payment':
      return f.itemPayment;
    case 'category':
      return f.itemCategory;
    case 'date':
      return f.itemDate;
    case 'payer':
      return f.itemPayer;
    case 'currency':
      return f.itemCurrency;
    case 'recurring':
      return f.itemRecurring;
    case 'lend':
      return f.itemLend;
    case 'work':
      return f.itemWork;
    default:
      return '';
  }
}

/** The question in the person's own terms: place names, people, trips. */
function questionText(
  q: FollowUpQuestion,
  f: UiStrings['followUps'],
  ctx: {
    saved: SavedState;
    group: { name: string } | null;
    amountLabel: string;
    categoryLabel: (id: string) => string;
  },
): string {
  switch (q.kind) {
    case 'place':
      return q.hereNow && q.places[0] ? fill(f.placeHere, { place: q.places[0] }) : f.placeAsk;
    case 'receipt':
      return f.receiptAsk;
    case 'split':
      return fill(f.splitAsk, {
        category: ctx.categoryLabel(ctx.saved.category ?? 'other').toLowerCase(),
        name: q.partners[0]?.name ?? '',
      });
    case 'payment':
      return f.paymentAsk;
    case 'trip':
      return fill(f.tripAsk, { trip: q.trip?.name ?? '' });
    case 'attendance':
      return f.attendanceAsk;
    case 'payer':
      return fill(f.payerAsk, { name: firstName(q.payer?.name ?? '') });
    case 'recurring':
      return f.recurringAsk;
    case 'duplicate':
      return fill(f.duplicateAsk, {
        name: firstName(q.duplicate?.authorName ?? ''),
        amount: q.duplicate
          ? format(money(q.duplicate.amountMinor, q.duplicate.currency))
          : ctx.amountLabel,
        description: q.duplicate?.description ?? '',
      });
    case 'currency':
      return fill(f.currencyAsk, { currency: q.currency ?? '' });
    case 'category':
      return f.categoryAsk;
    case 'date':
      return f.dateAsk;
    case 'lend':
      return fill(f.lendAsk, { name: q.person ?? '' });
    case 'wrapup':
      return fill(f.wrapupAsk, { trip: q.trip?.name ?? ctx.group?.name ?? '' });
    case 'work':
      return f.workAsk;
  }
}
