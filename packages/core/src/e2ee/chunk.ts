/**
 * Splits a snapshot into parts that each stay under 64 KiB once sealed
 * (nonce 24 B + tag 16 B + the JSON wrapper), the mailbox's message limit.
 */

import { encodeJson } from './envelope';
import type { RecordState } from './merge';

export const MAX_MESSAGE_BYTES = 64 * 1024;
const SEAL_OVERHEAD = 24 + 16;
const byteLen = (s: string): number => new TextEncoder().encode(s).length;

export interface SnapshotOp {
  readonly op: 'snapshot';
  readonly part: number;
  readonly of: number;
  readonly records: readonly RecordState[];
}

/** `msgId` is the id of the envelope that will carry each part (sizes its wrapper). */
export function chunkSnapshot(records: readonly RecordState[], msgId: string): SnapshotOp[] {
  // Wrapper sized with 9-digit part/of so any real count fits.
  const base =
    byteLen(
      encodeJson({
        v: 1,
        msgId,
        ops: [{ op: 'snapshot', part: 999999999, of: 999999999, records: [] }],
      }),
    ) + SEAL_OVERHEAD;
  const groups: RecordState[][] = [[]];
  let size = base;
  for (const r of records) {
    const n = byteLen(encodeJson(r)) + 1; // +1 for the comma
    if (base + n >= MAX_MESSAGE_BYTES)
      throw new Error(`e2ee: record ${r.id} is too large for one message`);
    if (size + n >= MAX_MESSAGE_BYTES) {
      groups.push([]);
      size = base;
    }
    groups[groups.length - 1]!.push(r);
    size += n;
  }
  return groups.map((g, i) => ({ op: 'snapshot', part: i, of: groups.length, records: g }));
}

/** Records once every part has arrived (any order, duplicates ignored), else null. */
export function reassemble(parts: readonly SnapshotOp[]): RecordState[] | null {
  const byPart = new Map<number, SnapshotOp>();
  for (const p of parts) byPart.set(p.part, p);
  const of = parts[0]?.of;
  if (!of || parts.some((p) => p.of !== of) || byPart.size !== of) return null;
  const out: RecordState[] = [];
  for (let i = 0; i < of; i++) {
    const p = byPart.get(i);
    if (!p) return null;
    out.push(...p.records);
  }
  return out;
}
