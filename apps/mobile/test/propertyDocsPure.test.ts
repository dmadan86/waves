import { describe, expect, it } from 'vitest';

import {
  addDoc,
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
});
