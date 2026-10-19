/**
 * The assistant's analytics carry enum words only (MC-TM-01).
 *
 * The same lists are enforced three times: by the types, by `assistantProps`
 * here, and by `waves_track_event` in the database (see
 * packages/db/test/app-events-assistant.test.ts). This is the phone's half.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENT_NAMES, buildPayload, isEventName, sanitizeProps } from '../src/lib/eventsCore';
import {
  ASSISTANT_PROP_VALUES,
  FOLLOWUP_KINDS,
  assistantProps,
  scopeOf,
  trackAssistant,
  trackAssistantPremiumViewed,
  type AssistantEventName,
} from '../src/lib/assistantTelemetry';

const h = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/events', () => ({ track: h.track }));

const ID = '3f2b8c1e-5d4a-4e7b-9c6a-1b2c3d4e5f60';
const EVENTS = Object.keys(ASSISTANT_PROP_VALUES) as AssistantEventName[];

beforeEach(() => {
  h.track.mockReset();
});

describe('MC-TM-01 the assistant events', () => {
  it('are exactly the ten in the spec, all known to eventsCore', () => {
    expect([...EVENTS].sort()).toEqual(
      [
        'assistant_opened',
        'assistant_command',
        'assistant_followup_shown',
        'assistant_followup_answered',
        'assistant_followup_skipped',
        'assistant_followup_muted',
        'assistant_correction',
        'assistant_undo',
        'assistant_question_answered',
        'assistant_teaser_viewed',
      ].sort(),
    );
    for (const name of EVENTS) expect(isEventName(name)).toBe(true);
    expect(EVENT_NAMES.filter((n) => n.startsWith('assistant_'))).toHaveLength(10);
  });

  it('every allowed word is a short lowercase word eventsCore would keep', () => {
    for (const name of EVENTS) {
      for (const [key, words] of Object.entries(ASSISTANT_PROP_VALUES[name])) {
        for (const word of words as readonly string[]) {
          expect(sanitizeProps({ [key]: word }), `${name}.${key}=${word}`).toEqual({ [key]: word });
        }
      }
    }
  });

  it('keeps an allowed prop and drops a word that is not on the event’s list', () => {
    expect(assistantProps('assistant_opened', { source: 'typed' })).toEqual({ source: 'typed' });
    expect(assistantProps('assistant_opened', { source: 'chip' })).toEqual({});
    expect(assistantProps('assistant_followup_shown', { kind: 'place', scope: 'group' })).toEqual({
      kind: 'place',
      scope: 'group',
    });
    expect(assistantProps('assistant_followup_shown', { kind: 'colour', scope: 'group' })).toEqual({
      scope: 'group',
    });
  });

  it('drops free text, numbers, objects and keys the event does not define', () => {
    expect(
      assistantProps('assistant_command', {
        path: 'agent',
        outcome: 'confirmed',
        scope: 'personal',
        transcript: 'add 800 for lunch with Anu',
        amount: 80000,
        description: 'lunch',
        kind: 'place',
      }),
    ).toEqual({ path: 'agent', outcome: 'confirmed', scope: 'personal' });
    expect(
      assistantProps('assistant_command', { path: 7, outcome: { a: 1 }, scope: null }),
    ).toEqual({});
    expect(assistantProps('assistant_undo', { what: 'Expense' })).toEqual({});
    expect(assistantProps('assistant_undo', undefined)).toEqual({});
  });

  it('sends through track with only whitelisted props, and nothing else', () => {
    trackAssistant('assistant_followup_answered', {
      kind: 'receipt',
      source: 'chip',
      path: 'device',
    });
    expect(h.track).toHaveBeenCalledWith('assistant_followup_answered', {
      kind: 'receipt',
      source: 'chip',
      path: 'device',
    });

    // A cast past the types still cannot get free text out.
    trackAssistant('assistant_followup_skipped', {
      kind: 'place',
      outcome: 'skipped',
      note: 'Blue Tokai',
    } as never);
    expect(h.track).toHaveBeenLastCalledWith('assistant_followup_skipped', {
      kind: 'place',
      outcome: 'skipped',
    });
  });

  it('survives the payload builder untouched: every event passes with its full prop set', () => {
    for (const name of EVENTS) {
      const props = Object.fromEntries(
        Object.entries(ASSISTANT_PROP_VALUES[name]).map(([key, words]) => [
          key,
          (words as readonly string[])[0],
        ]),
      );
      const payload = buildPayload({
        installId: ID,
        name,
        props,
        platform: 'android',
        version: '1.2.3',
      });
      expect(payload?.p_name).toBe(name);
      expect(payload?.p_props).toEqual(props);
    }
  });

  it('never throws, even if track does', () => {
    h.track.mockImplementation(() => {
      throw new Error('storage gone');
    });
    expect(() => trackAssistant('assistant_undo', { what: 'expense' })).not.toThrow();
    expect(() => trackAssistantPremiumViewed()).not.toThrow();
  });

  it('counts the plans view from a teaser under the existing premium_viewed event', () => {
    trackAssistantPremiumViewed();
    expect(h.track).toHaveBeenCalledWith('premium_viewed', { screen: 'assistant_teaser' });
    expect(sanitizeProps({ screen: 'assistant_teaser' })).toEqual({ screen: 'assistant_teaser' });
  });

  it('names the follow-up kinds the spec lists, and scopes a saved expense', () => {
    expect(FOLLOWUP_KINDS).toHaveLength(15);
    expect(new Set(FOLLOWUP_KINDS).size).toBe(15);
    expect(scopeOf('g1')).toBe('group');
    expect(scopeOf(null)).toBe('personal');
    expect(scopeOf(undefined)).toBe('personal');
  });
});
