/** Pure rules for documents kept on this phone against a rental property. Nothing here touches the server. */

export interface LocalDoc {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  /** Built-in slot id, or a custom slot id. Missing on documents saved before slots: they read as 'other'. */
  readonly slot?: string;
  /** Name of a custom slot, repeated on each of its files so the index shape stays flat. */
  readonly slotLabel?: string;
  /** Epoch ms the file was added. */
  readonly added?: number;
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
  if (pickerMime && MIME_EXT[pickerMime])
    return pickerMime === 'image/heif' ? 'image/heic' : pickerMime;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return EXT_MIME[ext] ?? null;
}

export const docExt = (mime: string): string => MIME_EXT[mime] ?? 'bin';
/** The file name inside the property's folder. */
export const docFileName = (d: Pick<LocalDoc, 'id' | 'mime'>): string =>
  `${d.id}.${docExt(d.mime)}`;

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

/** Tolerant read of the stored index: anything malformed is dropped, never thrown. */
export function parseIndex(text: string | null): DocIndex {
  try {
    const raw = JSON.parse(text ?? '{}') as Record<string, unknown>;
    const out: Record<string, LocalDoc[]> = {};
    for (const [pid, list] of Object.entries(raw)) {
      if (!Array.isArray(list)) continue;
      const docs = list.flatMap((d: Record<string, unknown>) =>
        typeof d?.id === 'string' && typeof d.name === 'string' && typeof d.mime === 'string'
          ? [
              {
                id: d.id,
                name: d.name,
                mime: d.mime,
                size: typeof d.size === 'number' ? d.size : 0,
                ...(typeof d.slot === 'string' && d.slot ? { slot: d.slot } : {}),
                ...(typeof d.slotLabel === 'string' && d.slotLabel
                  ? { slotLabel: d.slotLabel }
                  : {}),
                ...(typeof d.added === 'number' ? { added: d.added } : {}),
              },
            ]
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

export type BuiltinSlot = 'agreement' | 'tenant_id' | 'move_in' | 'police';
export const OTHER_SLOT = 'other';

/** Default slots for a region (the region string from regionOf). Police verification is an India thing. */
export function builtinSlots(region: string): BuiltinSlot[] {
  return region === 'IN'
    ? ['agreement', 'tenant_id', 'move_in', 'police']
    : ['agreement', 'tenant_id', 'move_in'];
}

export interface DocSlot {
  readonly id: string;
  readonly builtin: boolean;
  /** Custom name; undefined for built-ins and for the legacy 'other' slot (the screen words those). */
  readonly label?: string;
  readonly docs: readonly LocalDoc[];
}

/** Built-in slots (always shown), then custom ones in first-added order. Legacy docs land in 'other'. */
export function slotsOf(docs: readonly LocalDoc[], region: string): DocSlot[] {
  const builtin = builtinSlots(region) as string[];
  const out: DocSlot[] = builtin.map((id) => ({
    id,
    builtin: true,
    docs: docs.filter((d) => d.slot === id),
  }));
  const custom = new Map<string, LocalDoc[]>();
  for (const d of docs) {
    const id = d.slot ?? OTHER_SLOT;
    if (builtin.includes(id)) continue;
    custom.set(id, [...(custom.get(id) ?? []), d]);
  }
  for (const [id, list] of custom)
    out.push({ id, builtin: false, label: list.find((d) => d.slotLabel)?.slotLabel, docs: list });
  return out;
}

export const slotCount = (slots: readonly DocSlot[]): { filled: number; total: number } => ({
  filled: slots.filter((s) => s.docs.length > 0).length,
  total: slots.length,
});

export const newSlotId = (uniq: string): string => `c_${uniq}`;

/** Rename a custom slot (every file carries the label). Blank names are ignored. */
export function renameSlot(
  index: DocIndex,
  propertyId: string,
  slot: string,
  label: string,
): DocIndex {
  const clean = label.trim();
  if (!clean) return index;
  return {
    ...index,
    [propertyId]: docsOf(index, propertyId).map((d) =>
      (d.slot ?? OTHER_SLOT) === slot ? { ...d, slotLabel: clean } : d,
    ),
  };
}
