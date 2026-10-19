import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import { breaker, clearContextCache } from '../handler.ts';
import { parseToolCalls } from '../logic.ts';
import { fixtureContext, fixtures, WS2_LANDED, type EvalContextName } from './harness.ts';

interface ExpectedCall {
  tool: string;
  args: Record<string, unknown>;
  contains?: string[];
}
type Expected = ExpectedCall | ExpectedCall[];
interface Utterance {
  id: string;
  lang: 'en' | 'hinglish' | 'tamil-english' | 'correction' | 'clarify';
  text: string;
  context: EvalContextName;
  followUp?: { transcript: string; question: string };
  expect: Expected;
  alt?: Expected[];
}

const utterances: Utterance[] = JSON.parse(
  readFileSync(new URL('./utterances.json', import.meta.url), 'utf8'),
);
const callsOf = (value: Expected): ExpectedCall[] => (Array.isArray(value) ? value : [value]);
const ws2Dependent = (value: Expected) =>
  callsOf(value).some(
    ({ tool, args }) =>
      tool === 'delete_expense' ||
      (tool === 'update_expense' &&
        ['amountMinor', 'date', 'description', 'groupId', 'currency'].some((key) => key in args)),
  );

beforeEach(() => {
  breaker.reset();
  clearContextCache();
});

describe('eval fixture validation', () => {
  for (const entry of utterances) {
    it.skipIf(!WS2_LANDED && ws2Dependent(entry.expect))(
      `${entry.id} ${entry.lang} ${entry.text}`,
      () => {
        const result = parseToolCalls(
          callsOf(entry.expect).map(({ tool, args }) => ({ name: tool, input: args })),
          fixtureContext(entry.context),
        );
        expect(result).toMatchObject({ ok: true });
        if (!result.ok) throw new Error(result.reason);
        for (const expected of callsOf(entry.expect)) {
          if (expected.tool === 'answer_question') {
            expect(expected.contains?.length).toBeGreaterThan(0);
            expect(expected.contains!.some((part) => result.answer?.includes(part))).toBe(true);
          }
        }
        if (callsOf(entry.expect).some(({ tool }) => tool === 'ask_clarification')) {
          expect(result.clarify).toBeTruthy();
          const options = callsOf(entry.expect).find(({ tool }) => tool === 'ask_clarification')!
            .args.options;
          if (options) expect(result.clarifyOptions).toEqual(options);
        }
        const actionCalls = callsOf(entry.expect).filter(({ tool }) => actionTools.has(tool));
        expect(result.actions.map((action) => action.type)).toEqual(
          actionCalls.map(({ tool }) => tool),
        );
        const update = callsOf(entry.expect).find(({ tool }) => tool === 'update_expense');
        if (update) expect(result.update).toMatchObject(update.args);
        if (callsOf(entry.expect).some(({ tool }) => tool === 'delete_expense')) {
          expect(result).toMatchObject({ delete: { expenseId: fixtures.saved.group.id } });
        }
      },
    );
  }

  it('EV-01..EV-70 exactly 70 unique sequential IDs and required language counts', () => {
    expect(utterances).toHaveLength(70);
    expect(new Set(utterances.map(({ id }) => id)).size).toBe(70);
    expect(utterances.map(({ id }) => id)).toEqual(
      Array.from({ length: 70 }, (_, i) => `EV-${String(i + 1).padStart(2, '0')}`),
    );
    expect(
      Object.fromEntries(
        ['en', 'hinglish', 'tamil-english', 'correction', 'clarify'].map((lang) => [
          lang,
          utterances.filter((entry) => entry.lang === lang).length,
        ]),
      ),
    ).toEqual({ en: 36, hinglish: 10, 'tamil-english': 6, correction: 14, clarify: 4 });
    expect(utterances.filter(({ followUp }) => followUp).map(({ id }) => id)).toEqual([
      'EV-67',
      'EV-68',
      'EV-69',
      'EV-70',
    ]);
  });

  it('EV-53..EV-66 follow-up expectations and alternatives never call action tools', () => {
    for (const entry of utterances.filter(({ context }) => context.startsWith('followup:'))) {
      for (const variant of [entry.expect, ...(entry.alt ?? [])]) {
        for (const { tool } of callsOf(variant)) {
          expect(actionTools.has(tool), `${entry.id}: ${tool}`).toBe(false);
        }
      }
    }
  });

  it('EV-01..EV-70 every expected ID and amount resolves in its fixture context', () => {
    for (const entry of utterances) {
      const context = fixtureContext(entry.context);
      const groups = entry.context === 'noGroups' ? [] : fixtures.groups;
      const members = entry.context === 'noGroups' ? [] : fixtures.members;
      for (const variant of [entry.expect, ...(entry.alt ?? [])]) {
        for (const { tool, args } of callsOf(variant)) {
          const visit = (value: unknown, key = '', groupId = args.groupId): void => {
            if (key === 'groupId')
              expect(
                groups.some(({ id }) => id === value),
                entry.id,
              ).toBe(true);
            if (key === 'expenseId') expect(value, entry.id).toBe(context.saved?.id);
            if (['memberId', 'paidByMemberId', 'fromMemberId', 'toMemberId'].includes(key)) {
              expect(
                members.some((member) => member.id === value && member.group_id === groupId),
                entry.id,
              ).toBe(true);
            }
            if (key === 'memberIds' || key === 'participants') {
              for (const id of value as string[]) {
                expect(
                  members.some((member) => member.id === id && member.group_id === groupId),
                  entry.id,
                ).toBe(true);
              }
            }
            if (key === 'amountMinor') {
              expect(value, entry.id).toMatch(/^[0-9]{1,15}$/);
              expect(BigInt(value as string), entry.id).toBeGreaterThan(0n);
              expect(BigInt(value as string), entry.id).toBeLessThanOrEqual(1000000000n);
            }
            if (Array.isArray(value)) value.forEach((child) => visit(child, '', groupId));
            else if (value && typeof value === 'object') {
              const object = value as Record<string, unknown>;
              Object.entries(object).forEach(([childKey, child]) =>
                visit(child, childKey, object.groupId ?? groupId),
              );
            }
          };
          visit(args);
          // Also enforce split totals, currencies, dates and tool-specific requirements
          // for every primary and permitted alternative supported by this checkout.
          if (WS2_LANDED || !ws2Dependent({ tool, args })) {
            expect(parseToolCalls([{ name: tool, input: args }], context), entry.id).toMatchObject({
              ok: true,
            });
          }
        }
      }
    }
  });
});

const actionTools = new Set([
  'add_expense',
  'add_personal',
  'record_settlement',
  'nudge',
  'create_group',
  'add_member',
]);
