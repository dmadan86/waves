/**
 * A group's description: what reaches the column, and what comes back.
 *
 * The field is written on the create screen but not by the create call — it
 * rides behind `group.create` as an ordinary `group.update`, the same way the
 * trip dates and the starting budget do, so that a new field can never give
 * `group.create` a new way to be refused (the one mutation whose refusal takes
 * the group with it). That shape is the thing worth pinning down without a
 * device: a group made with no description must queue exactly what it queued
 * before, and one made with a description must show it the instant it is typed
 * — before any sync — because the queue overlay is the only place either lives
 * until the phone finds a network.
 */

import { describe, expect, it } from 'vitest';

import {
  emptyMirror,
  enqueue,
  materialiseGroup,
  MutationKind,
  reconcile,
  SyncTable,
  type MutationEnvelope,
  type QueuedMutation,
} from '@waves/core';

import { GROUP_DESCRIPTION_MAX, normaliseGroupDescription } from '../src/lib/groupDescription';

const GROUP = 'g-1';
const AT = '2026-03-01T09:00:00Z';

/** The envelope's payload is `unknown` by design — the queue carries every kind
 *  of mutation — so these tests pin it to a plain record and read fields off it
 *  directly, rather than casting at each assertion. */
type Envelope = MutationEnvelope<MutationKind, Record<string, unknown>>;

function envelope(id: string, kind: MutationKind, payload: Record<string, unknown>): Envelope {
  return { clientMutationId: id, kind, groupId: GROUP, clientCreatedAt: AT, payload };
}

function queued(...envelopes: Envelope[]): QueuedMutation[] {
  let queue: QueuedMutation[] = [];
  for (const item of envelopes) queue = enqueue(queue, item);
  return queue;
}

/** What the create screen would queue for a given typed description — the two
 *  lines of `submit` that decide it, with nothing else in the way. */
function mutationsFor(typed: string): Envelope[] {
  const create = envelope('m-1', MutationKind.GroupCreate, { name: 'Goa', currency: 'INR' });
  const description = normaliseGroupDescription(typed);
  return description
    ? [create, envelope('m-2', MutationKind.GroupUpdate, { description })]
    : [create];
}

describe('normaliseGroupDescription', () => {
  it('reads an empty or blank field as no description at all', () => {
    // NULL, not '': an empty string renders as a blank line everywhere the
    // description is shown, where an absent one renders as nothing.
    expect(normaliseGroupDescription('')).toBeNull();
    expect(normaliseGroupDescription('   \n  ')).toBeNull();
    expect(normaliseGroupDescription(null)).toBeNull();
    expect(normaliseGroupDescription(undefined)).toBeNull();
  });

  it('trims the whitespace around a real description', () => {
    expect(normaliseGroupDescription('  Goa, January, four of us  ')).toBe(
      'Goa, January, four of us',
    );
  });

  it('caps a long description at the length the column will accept', () => {
    const tooLong = 'a'.repeat(GROUP_DESCRIPTION_MAX + 50);
    const capped = normaliseGroupDescription(tooLong);
    expect(capped).toHaveLength(GROUP_DESCRIPTION_MAX);
  });

  it('leaves a description exactly at the cap alone', () => {
    // The boundary is inclusive on both sides — the input's maxLength lets this
    // one be typed, and the column's CHECK is `<= 280`.
    const exact = 'b'.repeat(GROUP_DESCRIPTION_MAX);
    expect(normaliseGroupDescription(exact)).toBe(exact);
  });

  it('counts characters, not bytes, so every script gets the same room', () => {
    // A Tamil description must not run out of space at a third of an English
    // one. `slice` works in UTF-16 code units and the column's CHECK uses
    // char_length, which is the same count for everything in these scripts.
    const tamil = 'கோ'.repeat(GROUP_DESCRIPTION_MAX);
    expect(normaliseGroupDescription(tamil)).toHaveLength(GROUP_DESCRIPTION_MAX);
  });
});

describe('creating a group', () => {
  it('queues nothing extra when no description was typed', () => {
    // The unchanged path, and the one that matters most: a group with no
    // description must put exactly one mutation on the queue, so the shortest
    // way through the screen is the same shape it has always been.
    const mutations = mutationsFor('');
    expect(mutations.map((m) => m.kind)).toEqual([MutationKind.GroupCreate]);
  });

  it('queues the description behind the create, never inside it', () => {
    const mutations = mutationsFor('Goa, January, flights already settled');
    expect(mutations.map((m) => m.kind)).toEqual([
      MutationKind.GroupCreate,
      MutationKind.GroupUpdate,
    ]);
    // Nothing about the description reaches the create payload: that is the
    // whole point of the ordering, so assert it rather than trusting it.
    expect(mutations[0]?.payload).not.toHaveProperty('description');
    expect(mutations[1]?.payload.description).toBe('Goa, January, flights already settled');
  });

  it('shows the description on the group before anything has synced', () => {
    // Offline, the queue overlay is the only place this group exists. A
    // description that could be typed but not read back until a network
    // appeared would be indistinguishable from one the app had thrown away.
    const queue = queued(...mutationsFor('Goa, January, flights already settled'));
    const group = materialiseGroup(emptyMirror(), queue, GROUP);
    expect(group?.description).toBe('Goa, January, flights already settled');
    expect(group?.pending).toBe(true);
  });

  it('leaves the group without a description when none was typed', () => {
    const queue = queued(...mutationsFor('   '));
    const group = materialiseGroup(emptyMirror(), queue, GROUP);
    expect(group?.id).toBe(GROUP);
    expect(group?.description ?? null).toBeNull();
  });
});

describe('editing a group', () => {
  /** A group as the server has already sent it down. */
  const mirrorWith = (description: string | null) =>
    reconcile(emptyMirror(), [
      {
        table: SyncTable.Groups,
        groupId: GROUP,
        seq: 1,
        row: {
          id: GROUP,
          name: 'Goa',
          description,
          default_currency: 'INR',
          created_at: AT,
          archived_at: null,
          deleted_at: null,
        },
      },
    ]).state;

  it('round-trips a description the server has confirmed', () => {
    const group = materialiseGroup(mirrorWith('Goa, January'), [], GROUP);
    expect(group?.description).toBe('Goa, January');
    expect(group?.pending).toBeUndefined();
  });

  it('shows an edit over the confirmed row while it is still queued', () => {
    const queue = queued(envelope('m-9', MutationKind.GroupUpdate, { description: 'Goa, August' }));
    const group = materialiseGroup(mirrorWith('Goa, January'), queue, GROUP);
    expect(group?.description).toBe('Goa, August');
  });

  it('clears a description with NULL, and the clear survives the overlay', () => {
    // Clearing has to reach the column as an absence rather than an empty
    // string, and the overlay has to show the absence — otherwise the field
    // looks cleared, then fills itself back in from the mirror row underneath.
    const queue = queued(envelope('m-9', MutationKind.GroupUpdate, { description: null }));
    const group = materialiseGroup(mirrorWith('Goa, January'), queue, GROUP);
    expect(group?.description).toBeNull();
  });
});
