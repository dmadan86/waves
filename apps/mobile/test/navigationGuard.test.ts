/**
 * The backstop behind the tap guard: the same screen, asked for twice by one
 * stuttering finger, opens once.
 *
 * This is the half that catches the navigations the shared kit cannot see — a
 * bare `Pressable` in a screen, a swipe action, a callback fired from a sheet.
 * The two things it must never do are pinned here as hard as the thing it must:
 * it must not eat a second, different destination, and it must not stand
 * between somebody and a screen they left and want back.
 *
 * Only the motions that can *stack* a screen are guarded at all — `push` and
 * `navigate`. `GuardedNavigation` is the whole list, and the type is the test:
 * `allow('replace', …)` and `allow('back', …)` do not compile. Backwards
 * motions must always be answered, and a `replace` cannot double up a screen,
 * so guarding it would only risk refusing a redirect that expo-router had
 * quietly dropped before the navigator mounted.
 */

import { describe, expect, it } from 'vitest';

import { SINGLE_ACTION_WINDOW_MS } from '@waves/ui/press';

import { createNavigationGuard, hrefKey } from '@/lib/navigationGuard';

function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let value = start;
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

describe('navigation guard', () => {
  it('drops a second push of the same href inside the window', () => {
    const time = clock();
    const guard = createNavigationGuard({ now: time.now });

    expect(guard.allow('push', '/group/7/settings')).toBe(true);
    time.advance(120);
    expect(guard.allow('push', '/group/7/settings')).toBe(false);
  });

  it('lets a different href straight through', () => {
    const time = clock();
    const guard = createNavigationGuard({ now: time.now });

    // The exact thing a global "the app is navigating" lock would break:
    // settings, then invite, from the same header, in the same second.
    expect(guard.allow('push', '/group/7/settings')).toBe(true);
    time.advance(80);
    expect(guard.allow('push', '/group/7/invite')).toBe(true);
    time.advance(80);
    expect(guard.allow('push', '/group/8/settings')).toBe(true);
  });

  it('lets the same href through once the window has passed', () => {
    const time = clock();
    const guard = createNavigationGuard({ now: time.now });

    expect(guard.allow('push', '/capture')).toBe(true);
    time.advance(SINGLE_ACTION_WINDOW_MS);
    expect(guard.allow('push', '/capture')).toBe(true);
  });

  it('does not confuse a push with a navigate', () => {
    const time = clock();
    const guard = createNavigationGuard({ now: time.now });

    expect(guard.allow('push', '/welcome')).toBe(true);
    time.advance(50);
    expect(guard.allow('navigate', '/welcome')).toBe(true);
  });

  it('forgets everything when you leave the screen', () => {
    const time = clock();
    const guard = createNavigationGuard({ now: time.now });

    expect(guard.allow('push', '/group/7/settings')).toBe(true);
    time.advance(100);
    guard.reset(); // what back / dismiss / replace all do
    // Opened it, changed their mind, went back, opened it again — all inside
    // the window, and all deliberate.
    expect(guard.allow('push', '/group/7/settings')).toBe(true);
  });

  it('reads an object href as the destination it names', () => {
    const time = clock();
    const guard = createNavigationGuard({ now: time.now });

    const href = { pathname: '/group/[id]', params: { id: '7' } };
    expect(guard.allow('push', href)).toBe(true);
    time.advance(90);
    // A fresh object literal, same destination.
    expect(guard.allow('push', { pathname: '/group/[id]', params: { id: '7' } })).toBe(false);
    expect(guard.allow('push', { pathname: '/group/[id]', params: { id: '8' } })).toBe(true);
  });
});

describe('hrefKey', () => {
  it('passes a string href through', () => {
    expect(hrefKey('/group/7')).toBe('/group/7');
  });

  it('is stable however the params were written', () => {
    expect(hrefKey({ pathname: '/x', params: { b: '2', a: 1 } })).toBe(
      hrefKey({ pathname: '/x', params: { a: '1', b: 2 } }),
    );
  });

  it('does not collide when params contain query punctuation', () => {
    expect(hrefKey({ pathname: '/x', params: { a: '1&b=2' } })).not.toBe(
      hrefKey({ pathname: '/x', params: { a: '1', b: '2' } }),
    );
  });

  it('keeps a bare pathname bare', () => {
    expect(hrefKey({ pathname: '/x' })).toBe('/x');
  });
});
