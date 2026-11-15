import { expect, it } from 'vitest';
import { parseVoiceExpenses } from '@/lib/voiceExpense';
import rows from './fixtures/voiceGroupEval.json';

it('measures the real device parser and its shared intent', () => {
  const hits = { amount: 0, currency: 0, group: 0, description: 0, payer: 0, split: 0 };
  let wrong = 0;
  const misses: string[] = [];
  const members = ['Priya', 'Ravi', 'Madan', 'Renny', 'Arjun', 'Meera'].map((name) => ({
    id: name.toLowerCase(),
    name,
    isMe: name === 'Priya',
  }));
  for (const row of rows) {
    const result = parseVoiceExpenses(row.transcript, row.groups, {
      members,
      alternatives: row.alternatives,
      now: new Date('2026-10-01T12:00:00Z'),
    });
    if (row.expectedItemCount !== undefined)
      expect(result.items, row.id).toHaveLength(row.expectedItemCount);
    const item = result.items[0];
    const expected = row.expected;
    const id = result.group?.kind === 'existing' ? result.group.groupId : null;
    const candidates = result.groupCandidates?.map((c) => c.id) ?? [];
    const groupOK =
      expected.group.status === 'resolved'
        ? id === expected.group.id
        : expected.group.status === 'none'
          ? !id && !candidates.length
          : !id && expected.group.candidateIds?.every((id) => candidates.includes(id));
    if (id && (expected.group.status !== 'resolved' || id !== expected.group.id)) wrong++;
    if (groupOK) hits.group++;
    else misses.push(row.id);
    if ((item?.amountMinor?.toString() ?? null) === expected.amountMinor) hits.amount++;
    if ((item?.currency ?? null) === expected.currency) hits.currency++;
    if ((item?.note ?? '').toLowerCase().includes(expected.description.toLowerCase()))
      hits.description++;
    const payer = result.intent?.payer;
    if ((payer?.kind === 'me' ? 'me' : payer?.memberId) === expected.payer) hits.payer++;
    if (
      !expected.split
        ? !result.intent?.participants?.length
        : result.intent?.splitMode === expected.split.mode &&
          expected.split.memberIds?.every((id) =>
            result.intent?.participants?.some((p) => p.memberId === id),
          )
    )
      hits.split++;
  }
  process.stdout.write(
    'FIELD | CORRECT | TOTAL | ACCURACY\n' +
      Object.entries(hits)
        .map(
          ([field, count]) =>
            `${field} | ${count} | ${rows.length} | ${((100 * count) / rows.length).toFixed(1)}%`,
        )
        .join('\n') +
      `\nWrong confident groups: ${wrong}\nGroup misses: ${misses.join(', ')}`,
  );
  if (process.env.VOICE_EVAL_BASELINE !== '1') {
    expect(wrong).toBe(0);
    expect(hits.group / rows.length).toBeGreaterThanOrEqual(0.98);
  }
});

it.each(['for dinner', 'for rent', 'for Arjun'])(
  'does not assign ordinary description/member phrase %s',
  (phrase) => {
    const result = parseVoiceExpenses(
      `300 rupees ${phrase}`,
      [
        { id: 'dinner', name: 'Dinner' },
        { id: 'rent', name: 'Rent' },
        { id: 'arjun', name: 'Arjun Trip' },
      ],
      { members: [{ id: 'arjun', name: 'Arjun' }] },
    );
    expect(result.group).toBeNull();
  },
);

it('routes a literal flat identifier through the mobile normalization pipeline', () => {
  expect(
    parseVoiceExpenses('300 rupees dinner to Flat 4B', [
      { id: 'b', name: 'Flat 4B' },
      { id: 'c', name: 'Flat 4C' },
    ]).group,
  ).toEqual({ kind: 'existing', groupId: 'b' });
});

it('asks when a member and a group share the same name', () => {
  expect(
    parseVoiceExpenses('300 rupees for Arjun', [{ id: 'g', name: 'Arjun' }], {
      members: [{ id: 'arjun', name: 'Arjun' }],
    }).group,
  ).toBeNull();
});

it.each(['Goa Trip', 'Goa Trips'])('routes an exact %s ahead of its fuzzy rival', (name) => {
  const result = parseVoiceExpenses(`300 rupees dinner in ${name}`, [
    { id: 'singular', name: 'Goa Trip' },
    { id: 'plural', name: 'Goa Trips' },
  ]);
  expect(result.group).toEqual({
    kind: 'existing',
    groupId: name === 'Goa Trip' ? 'singular' : 'plural',
  });
  expect(result.items).toHaveLength(1);
  expect(result.items[0].amountMinor).toBe(30000n);
});

it('does not segment a room identifier into an extra expense', () => {
  const result = parseVoiceExpenses('300 rupees for room 4B in Goa Trip', [
    { id: 'goa', name: 'Goa Trip' },
  ]);
  expect(result.group).toEqual({ kind: 'existing', groupId: 'goa' });
  expect(result.items).toHaveLength(1);
  expect(result.items[0].amountMinor).toBe(30000n);
  expect(result.items[0].note).toBe('room');
});
