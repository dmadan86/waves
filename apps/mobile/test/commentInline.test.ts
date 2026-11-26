import { describe, expect, it } from 'vitest';

import { firstInlineMatch } from '@/lib/commentInline';

describe('comment inline markers', () => {
  it('leaves underscores inside words alone', () => {
    expect(firstInlineMatch('hello_from_B')).toBeNull();
    expect(firstInlineMatch('see my_file_v2 now')).toBeNull();
  });
  it('still reads real emphasis', () => {
    expect(firstInlineMatch('a _soft_ word')?.m[2]).toBe('soft');
    expect(firstInlineMatch('a *soft* word')?.m[2]).toBe('soft');
    expect(firstInlineMatch('**big**')?.kind).toBe('bold');
  });
});
