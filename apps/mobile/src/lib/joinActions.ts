/**
 * What the invite screen offers, given who is looking (ADR-006 amendment,
 * 2026-10-11).
 *
 * Joining a shared group needs an account, so there is no "continue as guest"
 * and no silent anonymous join anywhere in this list. Signed out: sign up or
 * log in. A guest: create an account (the identity they have is upgraded in
 * place, so what they hold is kept; the account screen already offers the
 * switch to a login that has an account of its own).
 * A real account: join.
 *
 * Kept pure, beside `joinGate` in @waves/core, so the rule is tested without
 * rendering the screen.
 */
import { JoinGate } from '@waves/core';

export type JoinAction = 'sign_up' | 'log_in' | 'create_account' | 'join';

export function joinActions(gate: JoinGate): readonly JoinAction[] {
  switch (gate) {
    case JoinGate.Ready:
      return ['join'];
    case JoinGate.UpgradeGuest:
      return ['create_account'];
    case JoinGate.SignUpOrLogIn:
      return ['sign_up', 'log_in'];
  }
}

/**
 * Where an account action leads. The guest's "create an account" goes to the
 * account screen, which attaches an email, phone or provider to the identity
 * they already have; the sign-up and log-in doors are only reachable signed out.
 */
export function routeForJoinAction(action: Exclude<JoinAction, 'join'>): string {
  switch (action) {
    case 'sign_up':
      return '/sign-up';
    case 'log_in':
      return '/sign-in';
    case 'create_account':
      return '/settings/account?reason=join';
  }
}
