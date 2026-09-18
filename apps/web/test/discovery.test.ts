/**
 * Reading a privacy setting out of the database.
 *
 * One line of logic, tested because of which way it fails. The column carries a
 * check constraint, so in practice it holds `nobody` or `groups` — but "the
 * constraint prevents it" is an argument about the database that a client
 * cannot make on its own behalf. A migration, a restore, a column added with a
 * different default: any of those can hand this function something else, and
 * the two possible mistakes are not equally bad.
 *
 * Reading an unknown value as `groups` shows somebody's phone number to a group
 * they never agreed to show it to. Reading it as `nobody` hides a number that
 * could have been shown. A privacy setting that fails open is not a privacy
 * setting.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_DISCOVERY, readContactVisibility } from '@waves/api-client';

describe('readContactVisibility', () => {
  it('reads the two values it knows', () => {
    expect(readContactVisibility('groups')).toBe('groups');
    expect(readContactVisibility('nobody')).toBe('nobody');
  });

  it('fails closed on anything else', () => {
    for (const odd of [null, undefined, '', 'GROUPS', 'everyone', 'public', 'group', ' groups']) {
      expect(readContactVisibility(odd), String(odd)).toBe('nobody');
    }
  });
});

describe('DEFAULT_DISCOVERY', () => {
  it('starts an account findable and visible to its own groups', () => {
    // The default is the open one, and that is a deliberate product choice
    // rather than the same fail-open the reader refuses: a value nobody has set
    // is not a value somebody set to something unreadable.
    expect(DEFAULT_DISCOVERY).toEqual({
      discoverableByPhone: true,
      discoverableByEmail: true,
      contactVisibility: 'groups',
    });
  });
});
