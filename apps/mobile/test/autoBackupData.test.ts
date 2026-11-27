import { describe, expect, it } from 'vitest';
import { hasCoupleBackupData } from '../src/lib/backup/autoBackupData';

describe('automatic backup couple data check', () => {
  it('keeps tombstone-only couple stores eligible for backup', () => {
    expect(
      hasCoupleBackupData([
        { groupId: 'g', name: 'Group', records: JSON.stringify([{ id: 'r', deleted: 123 }]) },
      ]),
    ).toBe(true);
  });
});
