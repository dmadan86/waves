/**
 * A company group takes company entries, never shared expenses: the server
 * refuses them, and a refused queued change is an error the owner must never
 * see. So every screen that picks a group to write an ordinary expense,
 * settlement, import or recurring rule into reads `useExpenseGroups`, which
 * drops company groups, not the raw `useGroups`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canAddSharedExpense } from '@waves/core';

const WRITERS = [
  'app/capture.tsx',
  'app/voice.tsx',
  'app/captures/sms/index.tsx',
  'app/settings/import.tsx',
  'app/settings/voice-recorder.tsx',
  'app/(tabs)/captures.tsx',
  'app/add-from-another-group.tsx',
  'components/QuickExpenseSheet.tsx',
  'components/VoiceConfirmCard.tsx',
  'lib/useSmsRowPlacement.ts',
];

const GUARDED_SCREENS = [
  'app/group/[id]/import.tsx',
  'app/group/[id]/recurring.tsx',
  'app/group/[id]/recurring-edit.tsx',
  'app/group/[id]/itemize.tsx',
];

const read = (file: string) => readFileSync(join(__dirname, '../src', file), 'utf8');

describe('add-expense group pickers', () => {
  it('never list a company group', () => {
    const groups = [
      { id: 'a', type: 'trip' },
      { id: 'b', type: 'company' },
      { id: 'c', type: 'home' },
    ];
    expect(groups.filter(canAddSharedExpense).map((g) => g.id)).toEqual(['a', 'c']);
  });

  it.each(WRITERS)('%s reads useExpenseGroups, not useGroups', (file) => {
    const code = read(file);
    expect(code).toMatch(/useExpenseGroups\(\)/);
    expect(code).not.toMatch(/[^.\w]useGroups\(\)/);
  });

  it.each(GUARDED_SCREENS)('%s sends a company group home', (file) => {
    expect(read(file)).toMatch(/useCompanyGroupGuard\(groupId\)/);
  });
});
