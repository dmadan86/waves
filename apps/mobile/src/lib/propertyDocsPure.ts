/** Pure rules for documents kept on this phone against a rental property. Nothing here touches the server. */

export interface LocalDoc {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
}
/** property id -> its documents. */
export type DocIndex = Readonly<Record<string, readonly LocalDoc[]>>;

const MIME_EXT: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
};
const EXT_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
};

/** The mime to keep for a picked file, or null when it is not a PDF or photo. */
export function docMime(name: string, pickerMime?: string | null): string | null {
  if (pickerMime && MIME_EXT[pickerMime]) return pickerMime === 'image/heif' ? 'image/heic' : pickerMime;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return EXT_MIME[ext] ?? null;
}

export const docExt = (mime: string): string => MIME_EXT[mime] ?? 'bin';
/** The file name inside the property's folder. */
export const docFileName = (d: Pick<LocalDoc, 'id' | 'mime'>): string => `${d.id}.${docExt(d.mime)}`;

export function docsOf(index: DocIndex, propertyId: string): readonly LocalDoc[] {
  return index[propertyId] ?? [];
}

export function addDoc(index: DocIndex, propertyId: string, doc: LocalDoc): DocIndex {
  return { ...index, [propertyId]: [...docsOf(index, propertyId), doc] };
}

export function removeDoc(index: DocIndex, propertyId: string, id: string): DocIndex {
  const { [propertyId]: mine = [], ...rest } = index;
  const left = mine.filter((d) => d.id !== id);
  return left.length ? { ...rest, [propertyId]: left } : rest;
}

export function renameDoc(index: DocIndex, propertyId: string, id: string, name: string): DocIndex {
  const clean = name.trim();
  if (!clean) return index;
  return {
    ...index,
    [propertyId]: docsOf(index, propertyId).map((d) => (d.id === id ? { ...d, name: clean } : d)),
  };
}

/** Folders on disk whose property no longer exists. */
export function orphanFolders(folders: readonly string[], liveIds: ReadonlySet<string>): string[] {
  return folders.filter((f) => !liveIds.has(f));
}

/** Tolerant read of the stored index: anything malformed is dropped, never thrown. */
export function parseIndex(text: string | null): DocIndex {
  try {
    const raw = JSON.parse(text ?? '{}') as Record<string, unknown>;
    const out: Record<string, LocalDoc[]> = {};
    for (const [pid, list] of Object.entries(raw)) {
      if (!Array.isArray(list)) continue;
      const docs = list.flatMap((d: Record<string, unknown>) =>
        typeof d?.id === 'string' && typeof d.name === 'string' && typeof d.mime === 'string'
          ? [{ id: d.id, name: d.name, mime: d.mime, size: typeof d.size === 'number' ? d.size : 0 }]
          : [],
      );
      if (docs.length) out[pid] = docs;
    }
    return out;
  } catch {
    return {};
  }
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
