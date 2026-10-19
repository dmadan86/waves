/**
 * The agent's several actions as one list: what each row says, how an edit to a
 * row's amount or words turns back into a proposal, and what the one footer
 * button is. Pure, so the list can be tested without a phone.
 */

import type { AgentLocalData } from '@/lib/voiceAgentPlan';
import { initialFields, resolveConfirm, type ConfirmableAction } from '@/lib/voiceConfirmPure';

export type CardStatus = 'pending' | 'running' | 'done' | 'failed' | 'discarded';

/** What a row's inline edit holds: the two fields a person fixes in place. */
export interface RowEdit {
  amountText: string;
  description: string;
}

/** The row's starting edit, as the proposal states it. */
export function rowEditFrom(
  action: ConfirmableAction,
  local: AgentLocalData,
  youLabel: string,
): RowEdit {
  const { amountText, description } = initialFields(action, local, youLabel);
  return { amountText, description };
}

/** The proposal with the row's edit applied, or null while the amount is not a number. */
export function editedAction(
  action: ConfirmableAction,
  local: AgentLocalData,
  youLabel: string,
  fallbackNote: string,
  edit: RowEdit,
): ConfirmableAction | null {
  const initial = initialFields(action, local, youLabel);
  const resolved = resolveConfirm(
    action,
    initial,
    { ...initial, ...edit },
    local,
    youLabel,
    fallbackNote,
  );
  if (resolved.ok) return resolved.action;
  // A row keeps the group and people it came with; only a bad amount fails it.
  return resolved.reason === 'amount' ? null : action;
}

export interface ListFooter {
  kind: 'none' | 'add' | 'done';
  /** Rows still to add (the button says "Add" for one, "Add all" for more). */
  count: number;
  disabled: boolean;
  /** After a save, "Add another" is offered. */
  addAnother: boolean;
}

/**
 * The one primary action under the list. Rows dropped with ✕ are out of it; once
 * every row is added or dropped it becomes Done. A failed row stays in, so the
 * same button retries it.
 */
export function listFooter(rows: readonly { problem: boolean; status: CardStatus }[]): ListFooter {
  if (rows.length === 0) return { kind: 'none', count: 0, disabled: true, addAnother: false };
  const settled = rows.every((row) => row.status === 'done' || row.status === 'discarded');
  if (settled) {
    return {
      kind: 'done',
      count: 0,
      disabled: false,
      addAnother: rows.some((row) => row.status === 'done'),
    };
  }
  const count = rows.filter(
    (row) => !row.problem && (row.status === 'pending' || row.status === 'failed'),
  ).length;
  const running = rows.some((row) => row.status === 'running');
  return { kind: 'add', count, disabled: count === 0 || running, addAnother: false };
}
