import { describe, expect, it } from 'vitest';

import {
  closeDialog,
  DIALOG_CANCEL,
  DIALOG_CONFIRM,
  EMPTY_DIALOG_QUEUE,
  isConfirmed,
  MAX_WAITING_DIALOGS,
  openDialog,
  presentationFor,
  SHEET_BODY_CHARS,
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
