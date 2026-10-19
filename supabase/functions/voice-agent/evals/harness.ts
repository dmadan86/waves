/**
 * Shared fixtures for the follow-up integration, injection and eval tests.
 * The same fixtures.json feeds scripts/voice-eval.mjs, so the mocked tests and
 * the live run see the identical context.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildContext,
  TOOLS,
  type RawBalance,
  type RawGroup,
  type RawMember,
  type VoiceContext,
} from '../logic.ts';

export interface Fixtures {
  meProfileId: string;
  today: string;
  currentGroupId: string;
  groups: RawGroup[];
  members: RawMember[];
  balances: RawBalance[];
  saved: {
    personal: { id: string; kind: 'personal'; question?: string };
    group: { id: string; kind: 'group'; groupId: string; question?: string };
  };
}

export const fixtures: Fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures.json', import.meta.url)), 'utf8'),
);

export type EvalContextName = 'default' | 'noGroups' | 'followup:personal' | 'followup:group';

/** The VoiceContext for one eval context name, built exactly as the handler would. */
export function fixtureContext(name: EvalContextName = 'default'): VoiceContext {
  const base = buildContext({
    groups: name === 'noGroups' ? [] : fixtures.groups,
    members: name === 'noGroups' ? [] : fixtures.members,
    balances: name === 'noGroups' ? [] : fixtures.balances,
    meProfileId: fixtures.meProfileId,
    currentGroupId: name === 'noGroups' ? null : fixtures.currentGroupId,
    today: fixtures.today,
  });
  if (name === 'followup:personal') return { ...base, saved: fixtures.saved.personal };
  if (name === 'followup:group') return { ...base, saved: fixtures.saved.group };
  return base;
}

/**
 * True once WS2 has landed `delete_expense` in logic.ts. Tests written against
 * the WS2 schema (spec 3.2) are gated on this so they switch on by themselves
 * after the rebase instead of failing against the old validator.
 */
export const WS2_LANDED = TOOLS.some((tool) => tool.name === 'delete_expense');
