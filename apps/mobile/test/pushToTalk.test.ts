import { describe, expect, it, vi } from 'vitest';

import { MIN_HOLD_MS, PushToTalk } from '../src/lib/pushToTalk';

describe('pushToTalk', () => {
  it('starts idle', () => {
    const gesture = new PushToTalk();
    expect(gesture.getSnapshot()).toEqual({ holding: false, ended: null });
    expect(gesture.take()).toBeNull();
  });

  it('reads a press held long enough as a sentence to finish', () => {
    const gesture = new PushToTalk();
    gesture.begin(0);
    expect(gesture.getSnapshot().holding).toBe(true);
    expect(gesture.release(MIN_HOLD_MS)).toBe('send');
    expect(gesture.getSnapshot().holding).toBe(false);
    expect(gesture.take()).toEqual({ seq: 1, mode: 'send' });
  });

  it('reads a press too brief to carry speech as a plain tap', () => {
    const gesture = new PushToTalk();
    gesture.begin(0);
    expect(gesture.release(MIN_HOLD_MS - 1)).toBe('tap');
    // Nothing to act on: the screen is open and should keep listening, exactly
    // as a tap has always left it.
    expect(gesture.take()).toBeNull();
  });

  it('obeys a slide-away however brief the hold was', () => {
    const gesture = new PushToTalk();
    gesture.begin(0);
    expect(gesture.cancel()).toBe('cancel');
    expect(gesture.take()).toEqual({ seq: 1, mode: 'cancel' });
  });

  it('ignores a release or a cancel that no hold preceded', () => {
    const gesture = new PushToTalk();
    expect(gesture.release(10_000)).toBe('tap');
    expect(gesture.cancel()).toBeNull();
    expect(gesture.take()).toBeNull();
  });

  it('delivers an ending once', () => {
    const gesture = new PushToTalk();
    gesture.begin(0);
    gesture.release(1000);
    expect(gesture.take()).not.toBeNull();
    expect(gesture.take()).toBeNull();
  });

  it('keeps an ending waiting for a screen that has not mounted yet', () => {
    const gesture = new PushToTalk();
    gesture.begin(0);
    gesture.release(1000);
    // Nobody was listening at the time; the fact survives until it is taken.
    expect(gesture.getSnapshot().ended).toEqual({ seq: 1, mode: 'send' });
    expect(gesture.take()).toEqual({ seq: 1, mode: 'send' });
  });

  it('drops an unclaimed ending when a new hold starts', () => {
    const gesture = new PushToTalk();
    gesture.begin(0);
    gesture.release(1000);
    // The capture that ending belonged to is over; applying it to the next hold
    // would close that one the moment it opened.
    gesture.begin(2000);
    expect(gesture.getSnapshot()).toEqual({ holding: true, ended: null });
  });

  it('numbers endings so two in a row are told apart', () => {
    const gesture = new PushToTalk();
    gesture.begin(0);
    gesture.release(1000);
    expect(gesture.take()?.seq).toBe(1);
    gesture.begin(2000);
    gesture.release(3000);
    expect(gesture.take()?.seq).toBe(2);
  });

  it('tells subscribers about every change and stops on unsubscribe', () => {
    const gesture = new PushToTalk();
    const listener = vi.fn();
    const unsubscribe = gesture.subscribe(listener);
    gesture.begin(0);
    gesture.release(1000);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    gesture.begin(2000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('hands out a fresh snapshot object per change', () => {
    const gesture = new PushToTalk();
    const before = gesture.getSnapshot();
    gesture.begin(0);
    // useSyncExternalStore compares by identity — a mutated snapshot would never
    // re-render the screen holding the mic.
    expect(gesture.getSnapshot()).not.toBe(before);
  });
});
