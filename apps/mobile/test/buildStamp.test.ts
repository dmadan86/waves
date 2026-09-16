import { describe, expect, it } from 'vitest';

import { formatBuildStamp } from '@/lib/buildStamp';

describe('the build stamp', () => {
  it('names the version, the build number and the commit', () => {
    expect(formatBuildStamp({ version: '1.0.0', build: '5', commit: '4f2c9ab' })).toBe(
      '1.0.0 (5) · 4f2c9ab',
    );
  });

  /**
   * The commit is the part that actually answers "is this the build with the
   * fix?", because it changes on every build whether or not anybody bumped a
   * version. A checkout with no git directory has none, and the stamp has to
   * stay readable rather than trailing a separator.
   */
  it('drops the commit when the build was made without one', () => {
    expect(formatBuildStamp({ version: '1.0.0', build: '5', commit: null })).toBe('1.0.0 (5)');
  });

  it('drops the build number when the config has none', () => {
    expect(formatBuildStamp({ version: '1.0.0', build: null, commit: '4f2c9ab' })).toBe(
      '1.0.0 · 4f2c9ab',
    );
  });

  it('renders nothing at all rather than punctuation, when nothing is known', () => {
    expect(formatBuildStamp({ version: null, build: null, commit: null })).toBe('');
  });

  it('treats blank strings as missing, not as parts', () => {
    expect(formatBuildStamp({ version: '1.0.0', build: '  ', commit: '' })).toBe('1.0.0');
  });
});
