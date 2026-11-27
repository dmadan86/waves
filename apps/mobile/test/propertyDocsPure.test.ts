import { describe, expect, it } from 'vitest';

import {
  addDoc,
  builtinSlots,
  newSlotId,
  renameSlot,
  slotCount,
  slotsOf,
  docFileName,
  docMime,
  orphanFolders,
  parseIndex,
  removeDoc,
  renameDoc,
  type LocalDoc,
} from '@/lib/propertyDocsPure';

const d = (id: string): LocalDoc => ({ id, name: `${id}.pdf`, mime: 'application/pdf', size: 10 });

describe('propertyDocsPure', () => {
  it('adds, renames and removes a document per property', () => {
    let i = addDoc({}, 'p1', d('a'));
    i = addDoc(i, 'p1', d('b'));
    i = addDoc(i, 'p2', d('c'));
    i = renameDoc(i, 'p1', 'a', '  Agreement  ');
    expect(i.p1![0]!.name).toBe('Agreement');
    expect(renameDoc(i, 'p1', 'a', '  ')).toBe(i);
    i = removeDoc(i, 'p1', 'a');
    expect(i.p1!.map((x) => x.id)).toEqual(['b']);
    i = removeDoc(i, 'p2', 'c');
    expect(i.p2).toBeUndefined();
  });

  it('finds folders of deleted properties', () => {
    expect(orphanFolders(['p1', 'gone'], new Set(['p1']))).toEqual(['gone']);
  });

  it('maps mime and extension', () => {
    expect(docMime('x.PDF')).toBe('application/pdf');
    expect(docMime('x.jpeg')).toBe('image/jpeg');
    expect(docMime('x', 'image/heif')).toBe('image/heic');
    expect(docMime('x.docx', 'application/msword')).toBeNull();
    expect(docFileName({ id: 'a', mime: 'image/png' })).toBe('a.png');
  });

  it('round-trips the index and survives garbage', () => {
    const i = addDoc({}, 'p1', d('a'));
    expect(parseIndex(JSON.stringify(i))).toEqual(i);
    expect(parseIndex('{nope')).toEqual({});
    expect(parseIndex(JSON.stringify({ p: [{ id: 1 }] }))).toEqual({});
  });

  describe('slots', () => {
    const s = (id: string, slot?: string, slotLabel?: string): LocalDoc => ({
      ...d(id),
      ...(slot ? { slot } : {}),
      ...(slotLabel ? { slotLabel } : {}),
    });

    it('lists default slots per region; only India gets police verification', () => {
      expect(builtinSlots('IN')).toEqual(['agreement', 'tenant_id', 'move_in', 'police']);
      expect(builtinSlots('US')).toEqual(['agreement', 'tenant_id', 'move_in']);
      expect(builtinSlots('other')).not.toContain('police');
    });

    it('keeps legacy docs without a slot, grouped in one Other slot', () => {
      const slots = slotsOf([s('a'), s('b'), s('c', 'agreement')], 'US');
      expect(slots.map((x) => x.id)).toEqual(['agreement', 'tenant_id', 'move_in', 'other']);
      expect(slots[0]!.docs.map((x) => x.id)).toEqual(['c']);
      expect(slots[3]!.docs.map((x) => x.id)).toEqual(['a', 'b']);
    });

    it('counts filled of total, including custom slots', () => {
      const docs = [s('a', 'agreement'), s('b', 'c1', 'Electricity bill')];
      expect(slotCount(slotsOf(docs, 'IN'))).toEqual({ filled: 2, total: 5 });
      expect(slotCount(slotsOf([], 'US'))).toEqual({ filled: 0, total: 3 });
    });

    it('creates a custom slot by adding a doc with a label, several files per slot', () => {
      let i = addDoc({}, 'p', s('a', 'c1', 'Electricity bill'));
      i = addDoc(i, 'p', s('b', 'c1', 'Electricity bill'));
      const custom = slotsOf(i.p!, 'US').find((x) => x.id === 'c1')!;
      expect(custom.label).toBe('Electricity bill');
      expect(custom.docs).toHaveLength(2);
      expect(newSlotId('x')).toMatch(/^c_/);
    });

    it('renames a custom slot and drops it when its last doc goes', () => {
      let i = addDoc({}, 'p', s('a', 'c1', 'Old'));
      i = renameSlot(i, 'p', 'c1', '  New ');
      expect(slotsOf(i.p!, 'US').find((x) => x.id === 'c1')!.label).toBe('New');
      expect(renameSlot(i, 'p', 'c1', ' ')).toBe(i);
      i = removeDoc(i, 'p', 'a');
      expect(slotsOf(i.p ?? [], 'US').some((x) => x.id === 'c1')).toBe(false);
    });

    it('keeps slot fields through parseIndex and defaults old entries', () => {
      const out = parseIndex(
        JSON.stringify({
          p: [
            { id: 'a', name: 'a', mime: 'image/png', size: 1, slot: 'move_in', added: 5 },
            { id: 'b', name: 'b', mime: 'image/png' },
          ],
        }),
      );
      expect(out.p![0]).toMatchObject({ slot: 'move_in', added: 5 });
      expect(out.p![1]!.slot).toBeUndefined();
    });
  });
});
