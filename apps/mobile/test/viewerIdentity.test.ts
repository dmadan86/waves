/**
 * Who the destination pickers call you, and which photo they show.
 *
 * The pickers stopped saying "Just me" and started showing your own name and
 * face, which makes this derivation load-bearing in a way it was not while it
 * only fed two settings screens. The cases below are the ones that are silent
 * when wrong: a cleared photo has to fall through to the provider's, not be
 * handed on as an empty string, and a blank name has to reach the same "You"
 * the save path already writes — otherwise a chip appears with no label at all.
 */

import { describe, expect, it } from 'vitest';

import { viewerIdentityFrom } from '../src/lib/viewerIdentityCore';

const YOU = 'You';

describe('the name', () => {
  it('is the profile name when there is one', () => {
    expect(viewerIdentityFrom({ display_name: 'Madan' }, null, YOU).name).toBe('Madan');
  });

  it('trims it, so stray spaces do not read as a name', () => {
    expect(viewerIdentityFrom({ display_name: '  Madan  ' }, null, YOU).name).toBe('Madan');
  });

  it('falls back when the name is blank rather than showing an empty chip', () => {
    // A chip whose label is '' is a chip with a portrait and nothing beside it.
    expect(viewerIdentityFrom({ display_name: '   ' }, null, YOU).name).toBe(YOU);
    expect(viewerIdentityFrom({ display_name: '' }, null, YOU).name).toBe(YOU);
    expect(viewerIdentityFrom({ display_name: null }, null, YOU).name).toBe(YOU);
    expect(viewerIdentityFrom(null, null, YOU).name).toBe(YOU);
  });
});

describe('the photo', () => {
  it('prefers the profile column', () => {
    const identity = viewerIdentityFrom(
      { avatar_url: 'https://waves/mine.jpg' },
      { avatar_url: 'https://google/theirs.jpg' },
      YOU,
    );
    expect(identity.avatarUrl).toBe('https://waves/mine.jpg');
  });

  it('falls through to the provider when the column was never filled', () => {
    // Google and Apple accounts have a null avatar_url and so showed initials.
    const identity = viewerIdentityFrom(
      { avatar_url: null },
      { avatar_url: 'https://g/p.jpg' },
      YOU,
    );
    expect(identity.avatarUrl).toBe('https://g/p.jpg');
  });

  it('treats a cleared photo as no photo, not as a blank URL', () => {
    // The `||` vs `??` case. With `??` an empty string is "a value", and the
    // portrait becomes an <Image> pointed at nothing.
    const identity = viewerIdentityFrom({ avatar_url: '' }, { avatar_url: 'https://g/p.jpg' }, YOU);
    expect(identity.avatarUrl).toBe('https://g/p.jpg');
  });

  it('takes `picture` when the provider sends that instead', () => {
    const identity = viewerIdentityFrom(null, { picture: 'https://g/pic.jpg' }, YOU);
    expect(identity.avatarUrl).toBe('https://g/pic.jpg');
  });

  it('ends at null, so the avatar draws initials rather than a broken image', () => {
    expect(viewerIdentityFrom(null, null, YOU).avatarUrl).toBeNull();
    expect(viewerIdentityFrom({ avatar_url: '' }, { avatar_url: '' }, YOU).avatarUrl).toBeNull();
  });

  it('ignores a provider value that is not a string', () => {
    // `user_metadata` is untyped JSON from the provider; a number or an object
    // there must not reach an <Image> source.
    const identity = viewerIdentityFrom(null, { avatar_url: 42, picture: { url: 'x' } }, YOU);
    expect(identity.avatarUrl).toBeNull();
  });
});
