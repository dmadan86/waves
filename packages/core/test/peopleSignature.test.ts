/**
 * The "do these people already share a group?" key.
 *
 * The question is asked from two screens now — the voice review and the drafts
 * inbox — and both must answer it the same way, or the same three friends get a
 * second group from one screen and reuse the first from the other.
 */

import { describe, expect, it } from 'vitest';

import { peopleSignatureKey } from '../src/index';

describe('a set of people as one key', () => {
  it('ignores the order they were picked in', () => {
    expect(peopleSignatureKey(['Ravi', 'Sam'])).toBe(peopleSignatureKey(['Sam', 'Ravi']));
  });

  it('ignores case and the spaces around a typed name', () => {
    expect(peopleSignatureKey(['  ravi ', 'SAM'])).toBe(peopleSignatureKey(['Ravi', 'Sam']));
  });

  it('counts the same person named twice once', () => {
    expect(peopleSignatureKey(['Ravi', 'ravi', 'Sam'])).toBe(peopleSignatureKey(['Ravi', 'Sam']));
  });

  it('drops names that are nothing but whitespace', () => {
    expect(peopleSignatureKey(['Ravi', '   ', ''])).toBe(peopleSignatureKey(['Ravi']));
  });

  it('tells different people apart', () => {
    expect(peopleSignatureKey(['Ravi'])).not.toBe(peopleSignatureKey(['Ravi', 'Sam']));
    expect(peopleSignatureKey(['Ravi'])).not.toBe(peopleSignatureKey(['Sam']));
  });

  it('does not let a comma in one name look like two people', () => {
    expect(peopleSignatureKey(['a,b'])).not.toBe(peopleSignatureKey(['a', 'b']));
  });

  it('is empty when nobody is picked', () => {
    expect(peopleSignatureKey([])).toBe('');
  });
});
