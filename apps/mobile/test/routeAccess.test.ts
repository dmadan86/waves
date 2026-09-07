import { describe, expect, it } from 'vitest';

import { AUTH_ROUTES, isAuthRoute, isPublicRoute, isRouteAllowed } from '../src/lib/routeAccess';

const flags = { paywall: false };

describe('isAuthRoute', () => {
  it('names every door, so a session appearing on one moves the person into the app', () => {
    for (const route of AUTH_ROUTES) {
      expect(isAuthRoute([route])).toBe(true);
    }
  });

  it('does not count the app itself, or a route that merely starts like a door', () => {
    expect(isAuthRoute(['(tabs)'])).toBe(false);
    expect(isAuthRoute(['settings', 'account'])).toBe(false);
    expect(isAuthRoute(['sign-in-help'])).toBe(false);
    expect(isAuthRoute([])).toBe(false);
  });
});

describe('isPublicRoute', () => {
  it('lets a signed-out person sit on the doors', () => {
    for (const route of AUTH_ROUTES) {
      expect(isPublicRoute([route], false)).toBe(true);
    }
  });

  it('lets an invite, the language picker, and the policy screens through', () => {
    expect(isPublicRoute(['join'], false)).toBe(true);
    expect(isPublicRoute(['language'], false)).toBe(true);
    expect(isPublicRoute(['settings', 'privacy'], false)).toBe(true);
    expect(isPublicRoute(['settings', 'licenses'], false)).toBe(true);
  });

  it('keeps the rest of the app private for user, rider, traveller, and financer flows', () => {
    expect(isPublicRoute(['(tabs)'], false)).toBe(false);
    expect(isPublicRoute(['settings', 'account'], false)).toBe(false);
    expect(isPublicRoute(['friends', 'person', 'guest-1'], false)).toBe(false);
    expect(isPublicRoute(['group', 'abc', 'map'], false)).toBe(false);
    expect(isPublicRoute(['group', 'abc', 'plan'], false)).toBe(false);
    expect(isPublicRoute(['personal', 'transactions'], false)).toBe(false);
    expect(isPublicRoute(['personal', 'source', 'salary'], false)).toBe(false);
    expect(isPublicRoute(['voice'], false)).toBe(false);
    expect(isPublicRoute(['settings', 'offline-voice'], false)).toBe(false);
    expect(isPublicRoute(['capture'], false)).toBe(false);
  });

  it('exposes the local privacy audit only in a dev build', () => {
    expect(isPublicRoute(['dev', 'local-privacy'], true)).toBe(true);
    expect(isPublicRoute(['dev', 'local-privacy'], false)).toBe(false);
  });
});

describe('isRouteAllowed', () => {
  it('moves a signed-in person off every auth door', () => {
    for (const route of AUTH_ROUTES) {
      expect(isRouteAllowed([route], true, true, flags)).toBe(false);
    }
  });

  it('keeps signed-in production users out of development-only routes', () => {
    expect(isRouteAllowed(['dev', 'local-privacy'], true, false, flags)).toBe(false);
    expect(isRouteAllowed(['dev', 'local-privacy'], true, true, flags)).toBe(true);
  });

  it('honours flagged routes for both direct links and signed-in navigation', () => {
    expect(isRouteAllowed(['paywall'], true, false, { paywall: false })).toBe(false);
    expect(isRouteAllowed(['paywall'], true, false, { paywall: true })).toBe(true);
    expect(isRouteAllowed(['paywall'], false, false, { paywall: true })).toBe(false);
  });

  it('allows signed-in user, rider, traveller, and financer flows that are private', () => {
    expect(isRouteAllowed(['(tabs)'], true, false, flags)).toBe(true);
    expect(isRouteAllowed(['settings', 'account'], true, false, flags)).toBe(true);
    expect(isRouteAllowed(['friends', 'person', 'guest-1'], true, false, flags)).toBe(true);
    expect(isRouteAllowed(['group', 'abc', 'map'], true, false, flags)).toBe(true);
    expect(isRouteAllowed(['group', 'abc', 'plan'], true, false, flags)).toBe(true);
    expect(isRouteAllowed(['personal', 'transactions'], true, false, flags)).toBe(true);
    expect(isRouteAllowed(['personal', 'source', 'salary'], true, false, flags)).toBe(true);
    expect(isRouteAllowed(['voice'], true, false, flags)).toBe(true);
    expect(isRouteAllowed(['settings', 'offline-voice'], true, false, flags)).toBe(true);
  });
});
