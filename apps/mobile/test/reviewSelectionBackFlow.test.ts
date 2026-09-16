/**
 * The fixture behind `e2e/review-selection-back.yaml`, pinned here so the flow
 * cannot rot silently.
 *
 * That flow is the only end-to-end cover for the two bugs found on a phone on
 * 2026-09-16 — the navigation vanishing after leaving Review mid-selection, and
 * "Just me" refusing a whole batch — and it can only reach the ticking tab by
 * pasting bank messages, because an emulator has no inbox to read. If the
 * parser stops recognising the two bodies it pastes, the flow does not fail
 * loudly: it finds no rows to tick and quietly asserts nothing. So the bodies
 * live here too, and this is what says they are still payments.
 */

import { describe, expect, it } from 'vitest';

import { proposeFromSms } from '@waves/core';

/** Byte for byte what `review-selection-back.yaml` types into the paste box. */
const PASTED = [
  'Rs.970.00 debited from A/c XX4521 on 14-09-26 to M M RAITHARA TRADERS. UPI Ref 528913447120. -Axis Bank',
  'Rs.20.00 debited from A/c XX4521 on 14-09-26 to M M RAITHARA THE SHOP. UPI Ref 528913447999. -Axis Bank',
] as const;

describe('the messages the Review selection flow pastes', () => {
  const found = proposeFromSms(
    PASTED.map((body) => ({ body, receivedAt: '2026-09-14T10:00:00.000Z' })),
  );

  it('are both read as payments', () => {
    expect(found).toHaveLength(2);
  });

  it('arrive already ticked, so the flow has something to untick', () => {
    // A candidate the screen does not pre-select wears a "check this" badge and
    // starts unticked, and the flow's `Add 2 to Review` would be `Add 0`.
    expect(found.every((candidate) => candidate.preselect)).toBe(true);
  });

  it('carry the merchant the flow taps on', () => {
    // `tapOn: 'M M RAITHARA TRADERS'` is how the flow ticks a row; the merchant
    // is what the row is titled.
    expect(found[0]?.merchant).toBe('M M RAITHARA TRADERS');
  });

  it('carry a positive whole amount, which is what "Just me" can file', () => {
    // `planPersonalPlacement` refuses anything that is not a positive whole
    // number of minor units — a draft it refuses is counted, not filed, and the
    // flow's "the row leaves the pile" assertion would fail for the wrong
    // reason.
    for (const candidate of found) {
      expect(candidate.amount.minor > 0n).toBe(true);
    }
  });
});
