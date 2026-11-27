/**
 * Rental documents live ONLY on this phone: copied into the app's private document folder
 * (`property-docs/<propertyId>/<id>.<ext>`) with a small JSON index beside them. Nothing is uploaded and the
 * synced blob never mentions them, so other devices simply show none.
 */

import { randomUUID } from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { type MoveRecord } from './vehicleMove';
import {
  addDoc,
  docFileName,
  docsOf,
  parseIndex,
  rekeyIndex,
  removeDoc,
  renameDoc,
  renameSlot,
  type DocIndex,
  type LocalDoc,
} from './propertyDocsPure';

const root = () => new FileSystem.Directory(FileSystem.Paths.document, 'property-docs');
const indexFile = () => new FileSystem.File(root(), 'index.json');
const fileOf = (propertyId: string, d: LocalDoc) =>
  new FileSystem.File(root(), propertyId, docFileName(d));

export async function readIndex(): Promise<DocIndex> {
  try {
    const f = indexFile();
    return f.exists ? parseIndex(await f.text()) : {};
  } catch {
    return {};
  }
}

function writeIndex(index: DocIndex): void {
  root().create({ intermediates: true, idempotent: true });
  const f = indexFile();
  if (!f.exists) f.create({ intermediates: true });
  f.write(JSON.stringify(index));
}

/** Copy a picked file (cache uri) into the property's folder and record it. */
export async function attachDoc(
  propertyId: string,
  src: { uri: string; name: string; mime: string; size: number },
  slot?: { id: string; label?: string },
): Promise<LocalDoc> {
  const doc: LocalDoc = {
    id: randomUUID(),
    name: src.name,
    mime: src.mime,
    size: src.size,
    added: Date.now(),
    ...(slot ? { slot: slot.id } : {}),
    ...(slot?.label ? { slotLabel: slot.label } : {}),
  };
  const dest = fileOf(propertyId, doc);
  dest.parentDirectory.create({ intermediates: true, idempotent: true });
  new FileSystem.File(src.uri).copy(dest);
  writeIndex(addDoc(await readIndex(), propertyId, doc));
  return doc;
}

export async function renameLocalDoc(propertyId: string, id: string, name: string): Promise<void> {
  writeIndex(renameDoc(await readIndex(), propertyId, id, name));
}

export const localDocUri = (propertyId: string, d: LocalDoc): string => fileOf(propertyId, d).uri;

export async function renameLocalSlot(
  propertyId: string,
  slot: string,
  label: string,
): Promise<void> {
  writeIndex(renameSlot(await readIndex(), propertyId, slot, label));
}

export async function deleteLocalDoc(propertyId: string, id: string): Promise<void> {
  const index = await readIndex();
  const doc = docsOf(index, propertyId).find((d) => d.id === id);
  try {
    if (doc) {
      const f = fileOf(propertyId, doc);
      if (f.exists) f.delete();
    }
  } catch {
    // The index entry still goes.
  }
  writeIndex(removeDoc(index, propertyId, id));
}

/** Delete every document of a property (property deleted). */
export async function deleteAllDocs(propertyId: string): Promise<void> {
  try {
    const dir = new FileSystem.Directory(root(), propertyId);
    if (dir.exists) dir.delete();
  } catch {
    // Swept as an orphan later.
  }
  const index = await readIndex();
  if (index[propertyId]) {
    const { [propertyId]: _gone, ...rest } = index;
    writeIndex(rest);
  }
}

/** Hand the file to the system viewer / share sheet. False when it cannot be opened. */
export async function openLocalDoc(propertyId: string, doc: LocalDoc): Promise<boolean> {
  const f = fileOf(propertyId, doc);
  if (!f.exists || !(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(f.uri, { mimeType: doc.mime, dialogTitle: doc.name });
  return true;
}

/** Re-key every document of one owner to another id: move the folder, then the index entry. */
export async function rekeyDocs(from: string, to: string): Promise<void> {
  const index = await readIndex();
  if (!index[from]) return;
  new FileSystem.Directory(root(), to).create({ intermediates: true, idempotent: true });
  for (const d of index[from]) {
    const src = fileOf(from, d);
    if (src.exists) src.move(fileOf(to, d));
  }
  try {
    const dir = new FileSystem.Directory(root(), from);
    if (dir.exists) dir.delete();
  } catch {
    // Swept as an orphan later.
  }
  writeIndex(rekeyIndex(index, from, to));
}

const movesFile = () => new FileSystem.File(root(), 'moves.json');

/** Vehicle moves that started and have not finished (kept beside the documents index). */
export async function readMoves(): Promise<MoveRecord[]> {
  try {
    const f = movesFile();
    const raw = f.exists ? (JSON.parse(await f.text()) as unknown) : [];
    return Array.isArray(raw)
      ? raw.filter(
          (m): m is MoveRecord =>
            typeof m?.sourceId === 'string' &&
            typeof m.targetId === 'string' &&
            ['start', 'written', 'rekeyed'].includes(m.step),
        )
      : [];
  } catch {
    return [];
  }
}

/** Save (or, with `done`, remove) one move record. */
export async function saveMove(rec: MoveRecord, done = false): Promise<void> {
  const rest = (await readMoves()).filter((m) => m.sourceId !== rec.sourceId);
  root().create({ intermediates: true, idempotent: true });
  const f = movesFile();
  if (!f.exists) f.create({ intermediates: true });
  f.write(JSON.stringify(done ? rest : [...rest, rec]));
}
