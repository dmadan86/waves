/**
 * The root dialog provider: what `confirm`, `notify` and `choose` put on screen,
 * what each answer comes back as, the blank beat between one question and the
 * next, and what happens with no provider at all. The queue rules themselves
 * are pinned in dialogQueue.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider, isUnasked, useDialog } from '../src/lib/dialog';
import { DIALOG_CANCEL, DIALOG_CONFIRM, DIALOG_UNASKED } from '../src/lib/dialogQueue';
import { findOne, firstProvider, renderHook, type FakeElement } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());
vi.mock('@/components/AppDialog', () => ({ AppDialog: 'AppDialog' }));
vi.mock('@/i18n', () => ({
  useStrings: () => ({ t: { common: { cancel: 'Cancel', ok: 'OK' } } }),
}));

type Dialog = ReturnType<typeof useDialog>;
type Slot = {
  id: number;
  request: { title: string; actions: { id: string; label: string; tone: string; icon?: string }[] };
};

function mount() {
  const view = renderHook(() => DialogProvider({ children: null }));
  const value = () => firstProvider(view.result.current)!.value as Dialog;
  const surface = () =>
    findOne(view.result.current, (n: FakeElement) => n.type === 'AppDialog').props as {
      slot: Slot | null;
      visible: boolean;
      onChoose: (id: number, choice: string | null) => void;
    };
  return { view, value, surface };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('confirm', () => {
  it('draws a named affirmative door and a cancel, and answers true only for the affirmative', async () => {
    const { value, surface } = mount();
    const answer = value().confirm({ title: 'Delete?', confirmLabel: 'Delete', tone: 'danger' });

    const { slot, visible } = surface();
    expect(visible).toBe(true);
    expect(slot!.request.title).toBe('Delete?');
    expect(slot!.request.actions).toEqual([
      { id: DIALOG_CONFIRM, label: 'Delete', tone: 'danger' },
      { id: DIALOG_CANCEL, label: 'Cancel', tone: 'quiet' },
    ]);

    surface().onChoose(slot!.id, DIALOG_CONFIRM);
    await expect(answer).resolves.toBe(true);
    expect(surface()).toMatchObject({ slot: null, visible: false });
  });

  it('reads a cancel or a dismissal as no, and uses a custom cancel label', async () => {
    const { value, surface } = mount();
    const answer = value().confirm({ title: 'Leave?', confirmLabel: 'Leave', cancelLabel: 'Stay' });
    expect(surface().slot!.request.actions[0]!.tone).toBe('primary');
    expect(surface().slot!.request.actions[1]!.label).toBe('Stay');
    surface().onChoose(surface().slot!.id, null);
    await expect(answer).resolves.toBe(false);
  });
});

describe('notify', () => {
  it('has one quiet door and resolves when it is closed', async () => {
    const { value, surface } = mount();
    const done = value().notify({ title: 'Saved offline' });
    expect(surface().slot!.request.actions).toEqual([
      { id: DIALOG_CANCEL, label: 'OK', tone: 'quiet' },
    ]);
    surface().onChoose(surface().slot!.id, DIALOG_CANCEL);
    await expect(done).resolves.toBeUndefined();
  });
});

describe('choose', () => {
  const options = [
    { id: 'cancel', label: 'Cancel the trip' },
    { id: 'delete', label: 'Delete', tone: 'danger' as const, icon: 'trash' },
  ];

  it('returns the caller’s own id, even one that collides with the dialog’s own words', async () => {
    const { value, surface } = mount();
    const picked = value().choose({ title: 'What now?', options });
    const actions = surface().slot!.request.actions;
    expect(actions.map((a) => a.tone)).toEqual(['quiet', 'dangerQuiet', 'ghost']);
    expect(actions[1]!.icon).toBe('trash');

    surface().onChoose(surface().slot!.id, actions[0]!.id);
    await expect(picked).resolves.toBe('cancel');
  });

  it('returns null for the cancel door', async () => {
    const { value, surface } = mount();
    const picked = value().choose({ title: 'What now?', options, cancelLabel: 'Never mind' });
    expect(surface().slot!.request.actions.at(-1)!.label).toBe('Never mind');
    surface().onChoose(surface().slot!.id, DIALOG_CANCEL);
    await expect(picked).resolves.toBeNull();
  });
});

describe('one question after another', () => {
  it('queues the second, then hides the surface for a beat before showing it', async () => {
    const { value, surface } = mount();
    const first = value().confirm({ title: 'First', confirmLabel: 'Yes' });
    const second = value().confirm({ title: 'Second', confirmLabel: 'Yes' });
    expect(surface().slot!.request.title).toBe('First');

    surface().onChoose(surface().slot!.id, DIALOG_CONFIRM);
    await expect(first).resolves.toBe(true);
    expect(surface().slot!.request.title).toBe('Second');
    expect(surface().visible).toBe(false);

    vi.advanceTimersByTime(189);
    expect(surface().visible).toBe(false);
    vi.advanceTimersByTime(1);
    expect(surface().visible).toBe(true);

    surface().onChoose(surface().slot!.id, DIALOG_CANCEL);
    await expect(second).resolves.toBe(false);
  });

  it('restarts the beat when two answers land close together', () => {
    const { value, surface } = mount();
    void value().notify({ title: 'A' });
    void value().notify({ title: 'B' });
    void value().notify({ title: 'C' });

    surface().onChoose(surface().slot!.id, DIALOG_CANCEL);
    vi.advanceTimersByTime(100);
    surface().onChoose(surface().slot!.id, DIALOG_CANCEL);
    vi.advanceTimersByTime(100);
    expect(surface().visible).toBe(false);
    vi.advanceTimersByTime(90);
    expect(surface()).toMatchObject({ visible: true });
    expect(surface().slot!.request.title).toBe('C');
  });

  it('settles everything still open as unasked when the provider goes away', async () => {
    const { view, value, surface } = mount();
    const open = value().ask({ title: 'Open', actions: [] });
    void value().notify({ title: 'Queued' });
    void value().notify({ title: 'Queued 2' });
    surface().onChoose(surface().slot!.id, 'x');
    await open;

    const pending = value().ask({ title: 'Pending', actions: [] });
    view.unmount();
    await expect(pending).resolves.toBe(DIALOG_UNASKED);
  });
});

describe('outside a provider', () => {
  it('answers every question as unasked and warns in development', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const dialog = renderHook(() => useDialog()).result.current;

    expect(warn).toHaveBeenCalledOnce();
    const asked = await dialog.ask({ title: 'x', actions: [] });
    expect(isUnasked(asked)).toBe(true);
    await expect(dialog.confirm({ title: 'x', confirmLabel: 'y' })).resolves.toBe(false);
    await expect(dialog.notify({ title: 'x' })).resolves.toBeUndefined();
    await expect(dialog.choose({ title: 'x', options: [] })).resolves.toBeNull();
  });

  it('stays quiet in production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    renderHook(() => useDialog());
    expect(warn).not.toHaveBeenCalled();
  });
});
