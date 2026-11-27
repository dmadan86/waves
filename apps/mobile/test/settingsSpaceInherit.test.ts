import { describe, expect, it } from 'vitest';

import { inheritSettingsSpace } from '../src/lib/settingsRoute';

describe('inheritSettingsSpace', () => {
  it('carries the personal space onto settings pushes', () => {
    expect(inheritSettingsSpace('/settings/language', 'personal')).toBe(
      '/settings/language?space=personal',
    );
    expect(
      inheritSettingsSpace(
        { pathname: '/settings/packs/[slug]', params: { slug: 'a' } },
        'personal',
      ),
    ).toEqual({
      pathname: '/settings/packs/[slug]',
      params: { space: 'personal', slug: 'a' },
    });
  });
  it('leaves other routes and other spaces alone', () => {
    expect(inheritSettingsSpace('/personal/accounts', 'personal')).toBe('/personal/accounts');
    expect(inheritSettingsSpace('/settings/language', undefined)).toBe('/settings/language');
    expect(inheritSettingsSpace('/settings/a?space=personal', 'personal')).toBe(
      '/settings/a?space=personal',
    );
  });
});
