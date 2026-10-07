import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() },
}));

import {
  addCustomTemplate,
  CUSTOM_TEMPLATES_MAX,
  removeCustomTemplate,
} from '../src/lib/customEventTemplates';
import { showEmptyAddCta } from '../src/lib/emptyAddCta';

describe('custom event templates', () => {
  it('puts the newest first and dedupes case-insensitively', () => {
    let l = addCustomTemplate([], 'Housewarming');
    l = addCustomTemplate(l, 'Baby shower');
    l = addCustomTemplate(l, 'housewarming');
    expect(l).toEqual(['housewarming', 'Baby shower']);
  });
  it('caps the list and drops the oldest', () => {
    let l: string[] = [];
    for (let i = 0; i < CUSTOM_TEMPLATES_MAX + 2; i++) l = addCustomTemplate(l, `T${i}`);
    expect(l).toHaveLength(CUSTOM_TEMPLATES_MAX);
    expect(l[0]).toBe(`T${CUSTOM_TEMPLATES_MAX + 1}`);
  });
  it('ignores blanks and built-in names', () => {
    expect(addCustomTemplate(['A'], '   ')).toEqual(['A']);
    expect(addCustomTemplate(['A'], 'birthday party', ['Birthday party'])).toEqual(['A']);
  });
  it('removes one', () => {
    expect(removeCustomTemplate(['A', 'B'], 'a')).toEqual(['B']);
  });
});

describe('showEmptyAddCta', () => {
  it('shows only with no entries', () => {
    expect(showEmptyAddCta(0)).toBe(true);
    expect(showEmptyAddCta(1)).toBe(false);
  });
});
