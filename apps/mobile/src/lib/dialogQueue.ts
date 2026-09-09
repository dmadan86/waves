/**
 * The rules an app-owned dialog has to keep, written down away from React so
 * they can be tested (A66).
 *
 * `Alert.alert` was imperative and gave three things away for free that a
 * hand-rolled overlay does not: exactly one alert on screen at a time, a
 * hardware-back that dismissed it, and a callback that fired once or never.
 * Replacing it with a declarative `Popup` means owning all three by hand, and
 * "by hand" in a provider full of state is where they quietly stop being true.
 * So the decisions live here as plain functions over plain values: which
 * surface a request belongs on, what happens when a second question arrives
 * while the first is still being read, and what a dismissal means.
 *
 * Nothing in this file renders, and nothing in it resolves a promise — it says
 * *which* request should be resolved and the provider does it. That split is
 * the point: a reducer that also called `resolve` could not be tested without
 * standing up the tree it exists to keep honest.
 */

import type { CurrencyCode } from '@waves/core';

/**
 * The id the affirmative door carries on every confirmation, so
 * {@link isConfirmed} is the one place that knows what "yes" looks like.
 */
export const DIALOG_CONFIRM = 'confirm';

/** The id of the way out — the soft door, and what a dismissal is read as. */
export const DIALOG_CANCEL = 'cancel';

/**
 * What a request that was never drawn resolves to.
 *
 * A full queue refuses the newest question, and a provider that unmounts with
 * dialogs still open settles them. Neither is an answer, and neither may be
 * mistaken for one: `friends/merge` navigates the person off the screen when
 * its invite prompt is declined, so "declined" and "never asked" ending up the
 * same value would move somebody without asking. `confirm` reads this as a no,
 * because a question nobody saw is not a yes — but a caller that acts on the
 * *no* can tell the two apart by asking through {@link DialogRequest} directly.
 */
export const DIALOG_UNASKED = 'unasked';

/**
 * How a dialog can end.
 *
 * `null` is a dismissal: the scrim was tapped, or Android's back gesture was
 * used, or the queue refused the request. Every one of those means "no", and
 * they all have to reach the caller — a promise nobody settles is a screen
 * frozen behind an `await` that never returns.
 */
export type DialogChoice = string | null;

/** Whether the affirmative door was the one taken. A dismissal never is. */
export function isConfirmed(choice: DialogChoice): boolean {
  return choice === DIALOG_CONFIRM;
}

/** Whether a request was never put in front of anybody. Not an answer. */
export function isUnasked(choice: DialogChoice): boolean {
  return choice === DIALOG_UNASKED;
}

/** How loud the dialog is: a delete wears the danger mark, a question does not. */
export type DialogTone = 'danger' | 'neutral';

/**
 * The weight a door is drawn with — what it costs, not where it sits.
 *
 * Deliberately not "first button" and "the rest": a confirmation and an action
 * list want opposite things from their first row. A confirmation is asking for
 * one thing, so that thing is filled and loud and everything else recedes; an
 * action list is offering several, and drawing the top one as a filled brand
 * button turns a menu into a recommendation nobody asked it to make.
 *
 * - `primary` — the thing being asked for. Filled, brand.
 * - `danger` — the irreversible thing being asked for. Filled, red.
 * - `dangerQuiet` — the one row in a list that takes something away. Red on a
 *   soft ground, the way an action sheet has always drawn its destructive row.
 * - `quiet` — a peer, or the way out of a confirmation. Soft, full width.
 * - `ghost` — the way out of a list, which needs no weight at all.
 */
export type DialogActionTone = 'primary' | 'danger' | 'dangerQuiet' | 'quiet' | 'ghost';

export interface DialogAction {
  readonly id: string;
  readonly label: string;
  readonly tone?: DialogActionTone;
}

/**
 * One line of consequence, with its money kept as money.
 *
 * The delete-group warning lists who still owes whom, and the native alert
 * rendered that as one run-on paragraph — four real debts flattened into a
 * sentence nobody reads to the end. A row keeps the name and the amount apart
 * so the amount can be drawn by `MoneyText`, in the money colours, with the
 * screen-reader label money carries everywhere else in this app.
 */
export interface DialogRow {
  readonly key: string;
  readonly label: string;
  readonly amount?: { readonly minor: bigint; readonly currency: CurrencyCode };
  /** A second, quieter line under the label — a date, a group, a reason. */
  readonly hint?: string;
}

export interface DialogRequest {
  readonly title: string;
  readonly body?: string;
  /** Structured consequences, drawn as rows rather than folded into `body`. */
  readonly rows?: readonly DialogRow[];
  /** "and 3 more" — said when `rows` is a truncated view of something longer. */
  readonly moreRows?: string;
  /** The last word before the doors, drawn as a callout in the tone's colour. */
  readonly note?: string;
  readonly tone?: DialogTone;
  /** At least one door, each naming what it does. Never an "OK". */
  readonly actions: readonly DialogAction[];
  /**
   * Never dropped, however deep the queue is.
   *
   * The depth cap exists to stop a failing loop building a wall of *questions*.
   * A report is not a question — nothing branches on the answer, and the whole
   * reason it is a dialog rather than a toast is that it must be read. The
   * partial-result message after a batch assign is the only word anybody gets
   * that some drafts did not land; rationing it away would lose that outright.
   */
  readonly mustBeSeen?: boolean;
}

/**
 * Which of the app's two overlay surfaces a request is drawn on.
 *
 * Chosen by the shape of the request rather than by the caller, so the same
 * kind of question never turns up centred on one screen and bottom-anchored on
 * the next.
 */
export type DialogPresentation = 'popup' | 'sheet';

/**
 * Past this many characters a body has stopped being a sentence and started
 * being content, and content belongs somewhere it can scroll against a real
 * bound. Roughly four lines on the narrowest phone we support.
 */
export const SHEET_BODY_CHARS = 220;

/**
 * A centred dialog for a short question with two doors; a bottom sheet for
 * anything longer or wider than that.
 *
 * The split is the one the reference apps draw: Notion's "Delete transcript"
 * and Fabric's "Delete action" are two-button centred cards, while Nextdoor's
 * "Delete post?", Instacart's "Remove a member" and Cash App's "Remove goal" —
 * all of which carry a list, a paragraph of consequence, or a third option —
 * come up from the bottom edge where there is room and where the thumb is.
 *
 * It matters mechanically too, not only aesthetically: a `Sheet` is anchored to
 * an edge and can be given a definite height to scroll inside, where a centred
 * card that outgrows the window has nowhere to put the overflow.
 */
export function presentationFor(request: DialogRequest): DialogPresentation {
  if (request.rows !== undefined && request.rows.length > 0) return 'sheet';
  if (request.actions.length > 2) return 'sheet';
  if ((request.body?.length ?? 0) > SHEET_BODY_CHARS) return 'sheet';
  return 'popup';
}

/** A request waiting its turn, or being read right now. */
export interface DialogSlot {
  readonly id: number;
  readonly request: DialogRequest;
}

export interface DialogQueue {
  /** The one being read. Nothing else is on screen while this is set. */
  readonly current: DialogSlot | null;
  /** Asked while `current` was up, in the order they were asked. */
  readonly waiting: readonly DialogSlot[];
}

export const EMPTY_DIALOG_QUEUE: DialogQueue = { current: null, waiting: [] };

/**
 * How many questions may stack up behind the one on screen.
 *
 * There is a real case for queueing at all — a confirmation whose mutation
 * fails raises a second message from a `catch` block, and dropping it would
 * lose the only word anybody gets about the failure. There is no real case for
 * queueing *deeply*: a retry loop or a batch of failing writes could otherwise
 * build a wall of dialogs somebody has to tap through one at a time. Past this
 * depth the newest is refused (and resolved as a dismissal) rather than the
 * oldest evicted, because the oldest is the one somebody actually asked for.
 */
export const MAX_WAITING_DIALOGS = 3;

/**
 * Put a request on screen, or behind whatever is already there.
 *
 * `refused` means the queue was full and this request will never be shown; the
 * caller must resolve it as a dismissal immediately, which is exactly what a
 * person who never saw it would have meant.
 */
export function openDialog(
  queue: DialogQueue,
  slot: DialogSlot,
): { readonly queue: DialogQueue; readonly refused: boolean } {
  if (queue.current === null) {
    return { queue: { current: slot, waiting: queue.waiting }, refused: false };
  }
  if (queue.waiting.length >= MAX_WAITING_DIALOGS && slot.request.mustBeSeen !== true) {
    return { queue, refused: true };
  }
  return { queue: { current: queue.current, waiting: [...queue.waiting, slot] }, refused: false };
}

/**
 * Answer (or dismiss) the dialog on screen and promote the next one.
 *
 * `closed` is null when `id` is not the one showing — a second answer from a
 * double tap, or a close arriving after the surface has already moved on. That
 * case has to be silent rather than corrective: settling it would resolve a
 * promise twice, and promoting on it would skip a question nobody answered.
 */
export function closeDialog(
  queue: DialogQueue,
  id: number,
): { readonly queue: DialogQueue; readonly closed: DialogSlot | null } {
  if (queue.current === null || queue.current.id !== id) return { queue, closed: null };
  const [next, ...rest] = queue.waiting;
  return { queue: { current: next ?? null, waiting: rest }, closed: queue.current };
}

/**
 * The queue with the promises attached — everything the provider does, minus
 * React.
 *
 * It lives here rather than in the provider because this is where the contract
 * that matters is: a request settles exactly once, a stale answer settles
 * nothing, and a hub that goes away settles what it was holding. Those are
 * three sentences that are either true or not, and a test can say which — which
 * it cannot do while they are tangled up in `useState` and a component tree.
 *
 * `onChange` is called with the new queue whenever it moves, which is the one
 * thing the provider has to render from.
 */
export interface DialogHub {
  /** The queue as it stands. */
  readonly queue: () => DialogQueue;
  /** Put a question up (or behind whatever is up) and wait for its answer. */
  readonly ask: (request: DialogRequest) => Promise<DialogChoice>;
  /** Answer or dismiss the dialog on screen. A stale id does nothing. */
  readonly respond: (id: number, choice: DialogChoice) => void;
  /**
   * The surface is going away — settle everything still waiting.
   *
   * Without this a render error (the boundary swaps the tree out from under an
   * open dialog) or a Fast Refresh in development leaves every `await confirm`
   * hanging forever, and with it whatever `finally` the caller was relying on.
   */
  readonly dispose: () => void;
}

export function createDialogHub(onChange: (queue: DialogQueue) => void): DialogHub {
  let queue = EMPTY_DIALOG_QUEUE;
  let nextId = 1;
  // Keyed by id rather than held on the slot, so nothing that renders can reach
  // a resolver; and deleted before it is called, so a re-entrant `respond` from
  // inside a `.then` cannot find it twice.
  const waiting = new Map<number, (choice: DialogChoice) => void>();
  let disposed = false;

  const settle = (id: number, choice: DialogChoice): void => {
    const resolve = waiting.get(id);
    waiting.delete(id);
    resolve?.(choice);
  };

  const move = (next: DialogQueue): void => {
    queue = next;
    onChange(next);
  };

  return {
    queue: () => queue,

    ask: (request) =>
      new Promise<DialogChoice>((resolve) => {
        // A hub that has been disposed has no surface to draw on, so the honest
        // answer is the one a person who was never shown the question gave.
        if (disposed) {
          resolve(DIALOG_UNASKED);
          return;
        }
        const slot: DialogSlot = { id: nextId, request };
        nextId += 1;

        const step = openDialog(queue, slot);
        if (step.refused) {
          resolve(DIALOG_UNASKED);
          return;
        }
        waiting.set(slot.id, resolve);
        move(step.queue);
      }),

    respond: (id, choice) => {
      const step = closeDialog(queue, id);
      if (step.closed === null) return;
      move(step.queue);
      settle(id, choice);
    },

    dispose: () => {
      disposed = true;
      const ids = [...waiting.keys()];
      move(EMPTY_DIALOG_QUEUE);
      for (const id of ids) settle(id, DIALOG_UNASKED);
    },
  };
}
