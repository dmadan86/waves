import { describe, expect, it } from 'vitest';

import { foldedCaptureCount, voiceBatchId, type HasParsed } from '../src/lib/captureBatch';
import { captureInboxActionState } from '../src/lib/dashboardActions';

function capture(parsed?: unknown): HasParsed {
  return { parsed };
}

describe('voiceBatchId', () => {
  it('reads the batch id out of a parsed voice capture', () => {
    expect(voiceBatchId(capture({ voiceBatchId: 'b1' }))).toBe('b1');
  });

  it('is null for a capture with no batch id, or no parsed blob at all', () => {
    expect(voiceBatchId(capture())).toBeNull();
    expect(voiceBatchId(capture({}))).toBeNull();
    expect(voiceBatchId(capture({ voiceBatchId: '' }))).toBeNull();
  });
});

describe('foldedCaptureCount', () => {
  it('counts an empty inbox as zero', () => {
    expect(foldedCaptureCount([])).toBe(0);
  });

  it('counts each standalone capture once', () => {
    expect(foldedCaptureCount([capture(), capture(), capture()])).toBe(3);
  });

  it('folds every capture sharing a voice batch id into one', () => {
    const batch = [
      capture({ voiceBatchId: 'b1' }),
      capture({ voiceBatchId: 'b1' }),
      capture({ voiceBatchId: 'b1' }),
    ];
    expect(foldedCaptureCount(batch)).toBe(1);
  });

  it('mixes standalone captures and several batches without double counting', () => {
    const rows = [
      capture(),
      capture({ voiceBatchId: 'b1' }),
      capture({ voiceBatchId: 'b1' }),
      capture({ voiceBatchId: 'b2' }),
      capture(),
    ];
    // 2 standalone + 2 distinct batches = 4, not the 5 raw rows.
    expect(foldedCaptureCount(rows)).toBe(4);
  });
});

/**
 * The Review tab's badge (`AppTabBar`) and the dashboard hero's inbox card
 * used to feed this exact pipeline — fold, then decide the badge — and the
 * badge must never disagree with what the screen it opens is about to show.
 * Proving the two functions compose correctly here is what backs that claim,
 * beyond each function's own isolated tests.
 */
describe('folded count feeding the badge', () => {
  it('shows no badge when nothing is waiting — never a bare dot for zero', () => {
    expect(captureInboxActionState(foldedCaptureCount([])).badge).toBeUndefined();
  });

  it('badges the folded count, not the raw row count', () => {
    const rows = [
      capture({ voiceBatchId: 'b1' }),
      capture({ voiceBatchId: 'b1' }),
      capture({ voiceBatchId: 'b1' }),
      capture(),
    ];
    expect(captureInboxActionState(foldedCaptureCount(rows)).badge).toBe(2);
  });
});
