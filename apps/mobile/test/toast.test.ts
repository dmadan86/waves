/**
 * The root toast: one message at a time, the newest wins, a repeat of the same
 * words restarts it, and there is no crash with no provider.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider, useToast } from '../src/lib/toast';
import { findOne, firstProvider, renderHook, type FakeElement } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const env = vi.hoisted(() => ({ reduce: false, bottom: 48 }));

vi.mock('@waves/ui', () => ({ Toast: 'Toast' }));
vi.mock('@/lib/reducedMotion', () => ({ useReducedMotion: () => env.reduce }));
vi.mock('@/lib/clearance', () => ({ useBottomClearance: () => env.bottom }));

type Toast = ReturnType<typeof useToast>;

function mount() {
  const view = renderHook(() => ToastProvider({ children: null }));
  const value = () => firstProvider(view.result.current)!.value as Toast;
  // The host is a child component; render it on its own to see what it draws.
  const drawn = () => {
    const host = findOne(
      view.result.current,
      (n: FakeElement) => typeof n.type === 'function' && 'onDone' in n.props,
    );
    return renderHook(() => (host.type as (p: unknown) => FakeElement)(host.props)).result.current;
  };
  return { value, drawn };
}

beforeEach(() => {
  env.reduce = false;
  env.bottom = 48;
});

describe('the toast', () => {
  it('draws nothing until asked, clear of the bottom bar', () => {
    const { drawn } = mount();
    expect(drawn().type).toBe('Toast');
    expect(drawn().props).toMatchObject({
      visible: false,
      message: '',
      tone: 'positive',
      bottom: 48,
      animated: true,
    });
  });

  it('shows the newest message, positive by default, and a repeat restarts it', () => {
    const { value, drawn } = mount();
    value().show('Saved');
    expect(drawn().props).toMatchObject({ visible: true, message: 'Saved', tone: 'positive' });
    const firstKey = drawn().key;

    value().show('Saved');
    expect(drawn().key).not.toBe(firstKey);

    value().show('Could not save', 'negative');
    expect(drawn().props).toMatchObject({ message: 'Could not save', tone: 'negative' });
  });

  it('goes away when the toast says it is done', () => {
    const { value, drawn } = mount();
    value().show('Saved');
    (drawn().props.onDone as () => void)();
    expect(drawn().props.visible).toBe(false);
  });

  it('does not animate under reduced motion', () => {
    env.reduce = true;
    expect(mount().drawn().props.animated).toBe(false);
  });

  it('is a harmless no-op outside its provider', () => {
    const toast = renderHook(() => useToast()).result.current;
    expect(() => toast.show('x')).not.toThrow();
  });
});
