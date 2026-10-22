/**
 * People always render through PersonAvatar (photo, else initials).
 *
 * A bare `Avatar` from `@waves/ui` draws initials only, which is how group
 * settings came to show no profile photos. This scans the source so a new
 * screen cannot slip back: only the files below may import `Avatar` (or
 * `AvatarStack`) from `@waves/ui`, and each says why.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

/** Files that may use the bare Avatar, with the reason. Keep this short. */
const ALLOWED: Record<string, string> = {
  'components/PersonAvatar.tsx': 'the person avatar itself',
  'components/ProfileAvatar.tsx': 'the viewer-portrait wrapper (camera badge, picker)',
  'components/GroupCard.tsx': 'draws a group cover mark, not a person',
  'components/SaveToSheet.tsx': 'draws group cover marks; people go through PersonAvatar',
  'app/clone-group.tsx': 'draws a group cover emoji, not a person',
  'components/invite/SharedInviteCard.tsx':
    'rendered off-screen to a shareable image: a signed photo would not be loaded at capture, and a face should not leak into a shared picture',
  'app/group/[id]/member/[memberId].tsx': 'the expense rows there use a label badge, not a person',
  'app/friends/contacts.tsx': 'group cover marks and a names-only stack of unsynced contacts',
  'app/friends/merge.tsx': 'group cover marks and names-only stacks of guest duplicates',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const BARE_IMPORT = /import\s*\{[^}]*\bAvatar(Stack)?\b[^}]*\}\s*from\s*'@waves\/ui'/;
const LOCAL_PERSON_AVATAR = /function PersonAvatar\b/;

describe('people render through PersonAvatar', () => {
  const files = sources(SRC).map((path) => [relative(SRC, path), readFileSync(path, 'utf8')]);

  it('no screen outside the allowlist imports the bare Avatar', () => {
    const offenders = files
      .filter(([path, text]) => BARE_IMPORT.test(text) && !(path in ALLOWED))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('every allowlist entry still needs its exception', () => {
    const stale = Object.keys(ALLOWED).filter((path) => {
      const found = files.find(([file]) => file === path);
      return !found || !BARE_IMPORT.test(found[1]);
    });
    expect(stale).toEqual([]);
  });

  it('PersonAvatar is defined once', () => {
    const defs = files.filter(([, text]) => LOCAL_PERSON_AVATAR.test(text)).map(([path]) => path);
    expect(defs).toEqual(['components/PersonAvatar.tsx']);
  });
});
