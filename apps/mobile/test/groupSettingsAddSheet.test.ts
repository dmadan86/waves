/**
 * The group settings screen keeps the page short: adding a person is a "+ Add"
 * pill beside the member count that opens a bottom sheet, not a card inline.
 * The source is pinned rather than mounting the native screen.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCREEN = readFileSync(join(process.cwd(), 'src/app/group/[id]/settings.tsx'), 'utf8');

describe('Group settings add-someone sheet', () => {
  it('puts a + Add action in the members heading row', () => {
    expect(SCREEN).toContain('t.memberCount');
    expect(SCREEN).toMatch(/action=\{\s*<Button[^>]*label=\{`\+ \$\{t\.add\}`\}/s);
    expect(SCREEN).toContain('onPress={() => setAddOpen(true)}');
  });

  it('hosts the three routes and the by-name field in a titled Sheet', () => {
    const start = SCREEN.indexOf('<Sheet\n          visible={addOpen}');
    expect(start).toBeGreaterThan(-1);
    const sheet = SCREEN.slice(start, SCREEN.indexOf('</Sheet>', start));
    expect(sheet).toContain('title={t.people.addSomeone}');
    expect(sheet).toContain('routes.map');
    expect(sheet).toContain('t.people.orByName');
    expect(sheet).toContain('onPress={addMember}');
  });

  it('no longer draws the inline Add someone card', () => {
    const before = SCREEN.slice(0, SCREEN.indexOf('<Sheet\n          visible={addOpen}'));
    expect(before).not.toContain('routes.map');
    expect(before).not.toContain('t.people.orByName');
  });

  it('closes the sheet before following a route, and stays open after a name add', () => {
    const open = SCREEN.slice(SCREEN.indexOf('const openRoute'));
    expect(open.slice(0, 120)).toContain('setAddOpen(false)');
    const add = SCREEN.slice(SCREEN.indexOf('const addMember'), SCREEN.indexOf('const addPicked'));
    expect(add).not.toContain('setAddOpen(false)');
    expect(add).toContain('setJustAdded(person)');
  });
});
