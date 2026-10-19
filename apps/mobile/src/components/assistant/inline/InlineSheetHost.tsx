/**
 * The sheets the follow-up questions open over the voice screen: split with
 * people, move to a trip, who was there, split by item. This only chooses which
 * one shows and what it starts from; the writes belong to the caller
 * (`VoiceFollowUps`), which runs them through the saved bar's move so undo works.
 */

import { useCallback } from 'react';

import type { FollowUpKind } from '@waves/core';

import { fill, useStrings } from '@/i18n';
import { groupChoices, peopleIn, type Claims, type ItemizeDraft } from '@/lib/assistantInline';
import type { SavedState } from '@/lib/followUpApply';
import type { AgentLocalData } from '@/lib/voiceAgentPlan';
import { InlineItemizeSheet } from './InlineItemizeSheet';
import { InlinePeopleSheet } from './InlinePeopleSheet';

/** What a follow-up asked to open. `from` is the question to mark answered once it saved. */
export type InlineSheetRequest =
  | {
      readonly kind: 'split';
      readonly groupId: string;
      readonly memberIds: readonly string[];
      readonly from: FollowUpKind | null;
    }
  | { readonly kind: 'trip'; readonly groupId: string; readonly from: FollowUpKind | null }
  | { readonly kind: 'attendance'; readonly from: FollowUpKind | null }
  | {
      readonly kind: 'itemize';
      readonly draft: ItemizeDraft;
      readonly receiptId: string;
      /** The id the itemised expense is written under; it seeds the remainder, so the totals shown are the write's. */
      readonly seed: string;
      readonly from: FollowUpKind | null;
    };

export interface InlineSheetHostProps {
  request: InlineSheetRequest | null;
  saved: SavedState;
  local: AgentLocalData;
  amountLabel: string;
  busy: boolean;
  error: string | null;
  onMove: (request: InlineSheetRequest, groupId: string, memberIds: string[]) => void;
  onAttendance: (request: InlineSheetRequest, memberIds: string[]) => void;
  onItemize: (request: InlineSheetRequest, claims: Claims) => void;
  onClose: () => void;
}

export function InlineSheetHost({
  request,
  saved,
  local,
  amountLabel,
  busy,
  error,
  onMove,
  onAttendance,
  onItemize,
  onClose,
}: InlineSheetHostProps) {
  const { t } = useStrings();
  const s = t.inline;
  const peopleOf = useCallback((groupId: string) => peopleIn(local, groupId), [local]);

  if (!request) return null;
  // `key` remounts a sheet per request, so its picks start fresh each time.
  if (request.kind === 'itemize') {
    return (
      <InlineItemizeSheet
        key={`itemize-${request.receiptId}`}
        visible
        draft={request.draft}
        people={peopleOf(saved.groupId ?? '')}
        amount={saved.amount}
        currency={saved.currency}
        seed={request.seed}
        busy={busy}
        error={error}
        onConfirm={(claims) => onItemize(request, claims)}
        onClose={onClose}
      />
    );
  }
  if (request.kind === 'attendance') {
    const groupId = saved.groupId ?? '';
    return (
      <InlinePeopleSheet
        key="attendance"
        visible
        title={s.attendanceTitle}
        confirmLabel={s.attendanceSave}
        groups={[]}
        lockGroup
        initialGroupId={groupId}
        peopleOf={peopleOf}
        initialSelected={saved.participants}
        minOthers={0}
        selfOptional
        busy={busy}
        error={error}
        onConfirm={(_group, ids) => onAttendance(request, ids)}
        onClose={onClose}
      />
    );
  }
  const trip = request.kind === 'trip';
  return (
    <InlinePeopleSheet
      key={`${request.kind}-${request.groupId}`}
      visible
      title={trip ? s.tripTitle : fill(s.splitTitle, { amount: amountLabel })}
      confirmLabel={trip ? s.tripConfirm : s.splitConfirm}
      groups={groupChoices(local, saved.groupId)}
      lockGroup={trip}
      initialGroupId={request.groupId}
      peopleOf={peopleOf}
      initialSelected={trip ? 'all' : request.kind === 'split' ? request.memberIds : []}
      minOthers={trip ? 0 : 1}
      busy={busy}
      error={error}
      onConfirm={(groupId, ids) => onMove(request, groupId, ids)}
      onClose={onClose}
    />
  );
}
