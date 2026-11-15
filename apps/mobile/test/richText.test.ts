import { describe, expect, it } from 'vitest';

import { toggleWrap } from '../src/lib/richText';

describe('toggleWrap', () => {
  it('wraps a selection and keeps it selected', () => {
    expect(toggleWrap('hello world', { start: 6, end: 11 }, '**')).toEqual({
      text: 'hello **world**',
      selection: { start: 8, end: 13 },
    });
  });
  it('inserts a pair at an empty caret, then removes the empty pair', () => {
    const a = toggleWrap('ab', { start: 1, end: 1 }, '_');
    expect(a).toEqual({ text: 'a__b', selection: { start: 2, end: 2 } });
    expect(toggleWrap(a.text, a.selection, '_')).toEqual({
      text: 'ab',
      selection: { start: 1, end: 1 },
    });
  });
  it('unwraps when markers sit just outside the selection', () => {
    expect(toggleWrap('a ~~b~~ c', { start: 4, end: 5 }, '~~')).toEqual({
      text: 'a b c',
      selection: { start: 2, end: 3 },
    });
  });
  it('unwraps when the selection includes the markers', () => {
    expect(toggleWrap('a ~~b~~ c', { start: 2, end: 7 }, '~~')).toEqual({
      text: 'a b c',
      selection: { start: 2, end: 3 },
    });
  });
  it('nests different markers', () => {
    const bold = toggleWrap('hi', { start: 0, end: 2 }, '**');
    expect(toggleWrap(bold.text, bold.selection, '_').text).toBe('**_hi_**');
    expect(toggleWrap('**x**', { start: 2, end: 3 }, '_').text).toBe('**_x_**');
  });
  it('never splits a surrogate pair', () => {
    expect(toggleWrap('a😀b', { start: 1, end: 2 }, '**').text).toBe('a**😀**b');
    expect(toggleWrap('a😀b', { start: 2, end: 2 }, '**').text).toBe('a😀****b');
  });
  it('handles a reversed selection and empty text', () => {
    expect(toggleWrap('abc', { start: 3, end: 0 }, '**').text).toBe('**abc**');
    expect(toggleWrap('', { start: 0, end: 0 }, '~~')).toEqual({
      text: '~~~~',
      selection: { start: 2, end: 2 },
    });
  });
});
