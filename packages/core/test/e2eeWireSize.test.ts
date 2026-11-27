import { describe, expect, it } from 'vitest';

import { chunkSnapshot, encodeJson, MAX_MESSAGE_BYTES, wireSize } from '../src/e2ee';

const rec = (id: string, pad: number) => ({
  id,
  kind: 'property',
  createdBy: 'm',
  fields: { note: ['x'.repeat(pad), '1:0:a'] as const },
});

describe('snapshot wire size', () => {
  it('every chunk fits the mailbox limit including the frame byte and msgId', () => {
    const msgId = 'm'.repeat(40);
    const records = Array.from({ length: 40 }, (_, i) => rec(`r${i}`, 5000));
    const parts = chunkSnapshot(records, msgId);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      const json = encodeJson({ v: 1, msgId, ops: [p] });
      expect(wireSize(msgId, json)).toBeLessThan(MAX_MESSAGE_BYTES);
    }
  });

  it('a record that is exactly too big for a part is refused, one byte smaller fits', () => {
    const msgId = 'm'.repeat(40);
    const empty = encodeJson({
      v: 1,
      msgId,
      ops: [{ op: 'snapshot', part: 999999999, of: 999999999, records: [] }],
    });
    const base = wireSize(msgId, empty);
    const probe = encodeJson(rec('r', 0)).length + 1;
    // Largest pad that still fits: base + record + comma < limit.
    const pad = MAX_MESSAGE_BYTES - base - probe - 1;
    expect(() => chunkSnapshot([rec('r', pad)], msgId)).not.toThrow();
    expect(() => chunkSnapshot([rec('r', pad + 1)], msgId)).toThrow();
  });
});
