/**
 * Source-pinned: the activity feed opened from a group's hero (`?group=`) must
 * read as that group's own feed, not the global one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, '../src/app/activity.tsx'), 'utf8');

describe('activity screen scoped to one group', () => {
  it('forces white ink with a text shadow and titles the screen with the group', () => {
    expect(src).toContain('const darkInk = !onlyGroup && heroWantsDarkInk(hero);');
    expect(src).toContain('textShadowColor');
    expect(src).toMatch(/<GroupMark emoji=\{shownGroup\.cover_emoji\}/);
    expect(src).toContain('{shownGroup.name}');
    expect(src).toContain('shownGroup ? t.activity : t.activityScreen.subtitle');
  });

  it('drops the group-kind chip when scoped', () => {
    expect(src).toMatch(/\.\.\.\(onlyGroup\s*\?\s*\[\]/);
  });

  it('tags rows with the description or category instead of the group kind when scoped', () => {
    expect(src).toContain('scoped: !!onlyGroup');
    expect(src).toMatch(/tag: ctx\.scoped\s*\?\s*scopedTag\(description, category\)/);
  });

  it('has no start-a-group call to action in a scoped empty state', () => {
    expect(src).toContain('onlyGroup ? undefined : hasGroups');
  });
});
