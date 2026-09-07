import { describe, expect, it } from 'vitest';

import { AUTH_ROUTES, isAuthRoute, isPublicRoute } from '../src/lib/routeAccess';

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

  it('keeps the rest of the app private', () => {
    expect(isPublicRoute(['(tabs)'], false)).toBe(false);
    expect(isPublicRoute(['settings', 'account'], false)).toBe(false);
    expect(isPublicRoute(['group', 'abc', 'index'], false)).toBe(false);
    expect(isPublicRoute(['capture'], false)).toBe(false);
  });

  it('exposes the local privacy audit only in a dev build', () => {
    expect(isPublicRoute(['dev', 'local-privacy'], true)).toBe(true);
    expect(isPublicRoute(['dev', 'local-privacy'], false)).toBe(false);
  });
});
