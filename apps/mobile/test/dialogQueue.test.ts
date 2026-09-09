import { describe, expect, it } from 'vitest';

import {
  closeDialog,
  createDialogHub,
  DIALOG_CANCEL,
  DIALOG_CONFIRM,
  DIALOG_UNASKED,
  EMPTY_DIALOG_QUEUE,
  isConfirmed,
  isUnasked,
  MAX_WAITING_DIALOGS,
  openDialog,
  presentationFor,
  SHEET_BODY_CHARS,
  type DialogQueue,
  type DialogRequest,
  type DialogSlot,
} from '@/lib/dialogQueue';

const ask = (over: Partial<DialogRequest> = {}): DialogRequest => ({
  title: 'Delete this group?',
  actions: [
    { id: DIALOG_CONFIRM, label: 'Delete', tone: 'danger' },
    { id: DIALOG_CANCEL, label: 'Cancel', tone: 'quiet' },
  ],
  ...over,
});

const slot = (id: number, over: Partial<DialogRequest> = {}): DialogSlot => ({
  id,
  request: ask(over),
});

describe('what a dismissal means', () => {
  it('reads only the affirmative door as a yes', () => {
    expect(isConfirmed(DIALOG_CONFIRM)).toBe(true);
  });

  // The contract the whole replacement rests on: a scrim tap, an Android back
  // gesture and a refused request all arrive here as null, and every one of
  // them has to be a no rather than an unresolved promise or an accidental yes.
  it('reads a dismissal, a cancel and any other door as a no', () => {
    expect(isConfirmed(null)).toBe(false);
    expect(isConfirmed(DIALOG_CANCEL)).toBe(false);
    expect(isConfirmed('somethingElse')).toBe(false);
  });
});

describe('which surface a request is drawn on', () => {
  it('centres a short two-door question', () => {
    expect(presentationFor(ask({ body: 'This cannot be undone.' }))).toBe('popup');
  });

  it('sends a request carrying money rows to the bottom sheet', () => {
    expect(
      presentationFor(
        ask({
          rows: [{ key: 'a', label: 'Lokesh owes Madan', amount: { minor: 1n, currency: 'INR' } }],
        }),
      ),
    ).toBe('sheet');
  });

  it('keeps an empty row list centred, since there is nothing to scroll', () => {
    expect(presentationFor(ask({ rows: [] }))).toBe('popup');
  });

  it('sends a third option to the bottom sheet', () => {
    expect(
      presentationFor(
        ask({
          actions: [
            { id: 'scan', label: 'Scan' },
            { id: 'pick', label: 'Choose photo' },
            { id: DIALOG_CANCEL, label: 'Cancel' },
          ],
        }),
      ),
    ).toBe('sheet');
  });

  it('sends a body that has stopped being a sentence to the bottom sheet', () => {
    expect(presentationFor(ask({ body: 'x'.repeat(SHEET_BODY_CHARS + 1) }))).toBe('sheet');
    expect(presentationFor(ask({ body: 'x'.repeat(SHEET_BODY_CHARS) }))).toBe('popup');
  });
});

describe('two dialogs racing', () => {
  it('shows the first and holds the second behind it', () => {
    const first = openDialog(EMPTY_DIALOG_QUEUE, slot(1));
    expect(first.refused).toBe(false);
    expect(first.queue.current?.id).toBe(1);

    const second = openDialog(first.queue, slot(2));
    expect(second.refused).toBe(false);
    // The one being read is never replaced — a question that swapped itself out
    // mid-read is how somebody taps "Delete" meaning "Cancel".
    expect(second.queue.current?.id).toBe(1);
    expect(second.queue.waiting.map((entry) => entry.id)).toEqual([2]);
  });

  it('promotes the next one when the first is answered', () => {
    let queue = openDialog(EMPTY_DIALOG_QUEUE, slot(1)).queue;
    queue = openDialog(queue, slot(2)).queue;

    const closed = closeDialog(queue, 1);
    expect(closed.closed?.id).toBe(1);
    expect(closed.queue.current?.id).toBe(2);
    expect(closed.queue.waiting).toEqual([]);
  });

  it('empties out when the last one is answered', () => {
    const queue = openDialog(EMPTY_DIALOG_QUEUE, slot(1)).queue;
    const closed = closeDialog(queue, 1);
    expect(closed.queue.current).toBeNull();
  });

  // A double tap, or a close that arrives after the surface has moved on. Both
  // must be silent: settling would resolve a promise twice, and promoting would
  // skip a question nobody answered.
  it('ignores an answer for a dialog that is not the one showing', () => {
    const queue = openDialog(EMPTY_DIALOG_QUEUE, slot(1)).queue;
    const stale = closeDialog(queue, 99);
    expect(stale.closed).toBeNull();
    expect(stale.queue).toBe(queue);

    const answered = closeDialog(queue, 1);
    const again = closeDialog(answered.queue, 1);
    expect(again.closed).toBeNull();
  });

  it('ignores an answer against an empty queue', () => {
    expect(closeDialog(EMPTY_DIALOG_QUEUE, 1).closed).toBeNull();
  });

  it('refuses the newest once the queue is full, and keeps everything already asked', () => {
    let queue = openDialog(EMPTY_DIALOG_QUEUE, slot(0)).queue;
    for (let index = 1; index <= MAX_WAITING_DIALOGS; index += 1) {
      const step = openDialog(queue, slot(index));
      expect(step.refused).toBe(false);
      queue = step.queue;
    }

    const overflow = openDialog(queue, slot(99));
    // Refused, not evicting: the oldest is the one somebody actually asked for.
    expect(overflow.refused).toBe(true);
    expect(overflow.queue).toBe(queue);
    expect(overflow.queue.waiting.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });
});

describe('what a refusal means', () => {
  it('is not an answer, and not a confirmation', () => {
    expect(isUnasked(DIALOG_UNASKED)).toBe(true);
    expect(isConfirmed(DIALOG_UNASKED)).toBe(false);
  });

  it('is distinguishable from a deliberate cancel and from a dismissal', () => {
    expect(isUnasked(DIALOG_CANCEL)).toBe(false);
    expect(isUnasked(null)).toBe(false);
  });
});

/**
 * The promise plumbing — the half of this that a reducer test cannot reach.
 *
 * Everything below is the contract `lib/dialog.tsx` states in prose: a request
 * settles exactly once, a stale answer settles nothing, a refusal is its own
 * value, and a hub that goes away settles what it was holding rather than
 * leaving a caller awaiting forever.
 */
describe('the dialog hub', () => {
  const hubWithLog = () => {
    const seen: DialogQueue[] = [];
    const hub = createDialogHub((queue) => seen.push(queue));
    return { hub, seen };
  };

  it('resolves with the door that was taken', async () => {
    const { hub } = hubWithLog();
    const answer = hub.ask(ask());
    const id = hub.queue().current?.id ?? 0;

    hub.respond(id, DIALOG_CONFIRM);

    expect(isConfirmed(await answer)).toBe(true);
  });

  // The contract the whole replacement rests on. A scrim tap and the Android
  // back gesture both arrive as `respond(id, null)`.
  it('resolves a dismissal as a no, and empties the queue', async () => {
    const { hub } = hubWithLog();
    const answer = hub.ask(ask());

    hub.respond(hub.queue().current?.id ?? 0, null);

    expect(await answer).toBeNull();
    expect(isConfirmed(await answer)).toBe(false);
    expect(hub.queue().current).toBeNull();
  });

  it('tells the host every time the queue moves', async () => {
    const { hub, seen } = hubWithLog();
    const answer = hub.ask(ask());
    expect(seen).toHaveLength(1);

    hub.respond(hub.queue().current?.id ?? 0, DIALOG_CANCEL);
    await answer;

    expect(seen).toHaveLength(2);
    expect(seen[1]?.current).toBeNull();
  });

  it('holds the second question behind the first and answers each with its own door', async () => {
    const { hub } = hubWithLog();
    const first = hub.ask(ask({ title: 'first' }));
    const second = hub.ask(ask({ title: 'second' }));

    // Only the first is on screen; the second is not answerable yet.
    expect(hub.queue().current?.request.title).toBe('first');
    hub.respond(2, DIALOG_CONFIRM);
    expect(hub.queue().current?.request.title).toBe('first');

    hub.respond(1, DIALOG_CANCEL);
    expect(hub.queue().current?.request.title).toBe('second');
    hub.respond(2, DIALOG_CONFIRM);

    expect(await first).toBe(DIALOG_CANCEL);
    expect(await second).toBe(DIALOG_CONFIRM);
  });

  // Two fast taps on the scrim: the first answers what is on screen, the queue
  // promotes the next, and the second tap must not answer *that* one. The
  // surface binds each tap to the id it was drawn for, so this arrives stale.
  it('ignores a second answer for a dialog that has already been answered', async () => {
    const { hub } = hubWithLog();
    const first = hub.ask(ask({ title: 'first' }));
    const second = hub.ask(ask({ title: 'second' }));

    hub.respond(1, null);
    hub.respond(1, DIALOG_CONFIRM);

    expect(await first).toBeNull();
    expect(hub.queue().current?.request.title).toBe('second');

    hub.respond(2, DIALOG_CANCEL);
    expect(await second).toBe(DIALOG_CANCEL);
  });

  it('refuses a question once the queue is full, and says it was never asked', async () => {
    const { hub } = hubWithLog();
    const kept: Promise<unknown>[] = [];
    for (let index = 0; index <= MAX_WAITING_DIALOGS; index += 1) kept.push(hub.ask(ask()));

    const overflow = hub.ask(ask());

    expect(isUnasked(await overflow)).toBe(true);
    // Nothing already asked was displaced to make room for it.
    expect(hub.queue().waiting).toHaveLength(MAX_WAITING_DIALOGS);
    expect(kept).toHaveLength(MAX_WAITING_DIALOGS + 1);
  });

  // A report is not a question. The partial-result message after a batch assign
  // is the only word anybody gets that some drafts did not land, so rationing it
  // away would lose it outright.
  it('never refuses a request that must be seen', async () => {
    const { hub } = hubWithLog();
    for (let index = 0; index <= MAX_WAITING_DIALOGS; index += 1) void hub.ask(ask());

    void hub.ask(ask({ mustBeSeen: true }));

    expect(hub.queue().waiting).toHaveLength(MAX_WAITING_DIALOGS + 1);
  });

  // A render error swaps the tree out from under an open dialog, and every Fast
  // Refresh in development does the same. Neither may strand a `finally`.
  it('settles everything still open when it is disposed', async () => {
    const { hub } = hubWithLog();
    const first = hub.ask(ask());
    const second = hub.ask(ask());

    hub.dispose();

    expect(isUnasked(await first)).toBe(true);
    expect(isUnasked(await second)).toBe(true);
    expect(hub.queue().current).toBeNull();
  });

  it('answers as never-asked once it has been disposed', async () => {
    const { hub } = hubWithLog();
    hub.dispose();

    expect(isUnasked(await hub.ask(ask()))).toBe(true);
    expect(hub.queue().current).toBeNull();
  });
});
