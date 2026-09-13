/**
 * Bank messages into drafts, and the one rule that cannot be allowed to drift.
 *
 * A message a person *pasted* keeps its text: they put it there, and a capture
 * carries `rawText` for exactly this reason already (a scanned receipt's OCR
 * rides in the same field). A message this app *read out of the phone's inbox*
 * does not, ever — the parsed facts sync and the body is never written down at
 * all. The disclosure screen promises that in words; this is what makes it
 * true, and what will fail if somebody later "tidies up" the asymmetry.
 */

import { describe, expect, it } from 'vitest';

import { proposeFromSms, type SmsMessage } from '@waves/core';

import { bodiesByKey, planSmsDrafts, splitMessages, unreadableCount } from '@/lib/smsDrafts';

const SWIGGY = 'Rs.1,250.00 debited from a/c XX4471 on 02-03-26 at SWIGGY. UPI Ref: 412703998812';
const CAFE = 'Rs.240 debited at BLUE TOKAI on 03-03-26. Ref: 998877665544';

const sms = (body: string, receivedAt = '2026-03-02T10:00:00.000Z'): SmsMessage => ({
  body,
  receivedAt,
  sender: 'AD-HDFCBK',
});

const allOf = (messages: readonly SmsMessage[]) => {
  const candidates = proposeFromSms(messages);
  return { candidates, chosen: new Set(candidates.map((item) => item.dedupeKey)) };
};

describe('splitting a paste into messages', () => {
  it('splits on blank lines, not on every newline', () => {
    // A single SMS wraps; splitting per line would halve most of them, and half
    // a message parses to a smaller amount rather than to nothing.
    expect(splitMessages('one\nstill one\n\ntwo\n\n\nthree')).toEqual([
      'one\nstill one',
      'two',
      'three',
    ]);
  });

  it('drops the empty tail a trailing newline leaves', () => {
    expect(splitMessages('\n\n one \n\n  \n\n')).toEqual(['one']);
  });

  it('gives nothing for nothing', () => {
    expect(splitMessages('')).toEqual([]);
    expect(splitMessages('   \n  \n ')).toEqual([]);
  });
});

describe('a pasted message keeps its text', () => {
  const messages = [sms(SWIGGY)];
  const { candidates, chosen } = allOf(messages);

  it('carries the body as rawText', () => {
    const [draft] = planSmsDrafts({
      candidates,
      chosen,
      bodies: bodiesByKey(messages),
    });
    expect(draft?.rawText).toBe(SWIGGY);
    expect(draft?.parsed.channel).toBe('paste');
  });

  it('and is marked as having come from a message', () => {
    const [draft] = planSmsDrafts({ candidates, chosen, bodies: bodiesByKey(messages) });
    expect(draft?.parsed.source).toBe('sms');
    expect(draft?.parsed.sender).toBe('AD-HDFCBK');
    expect(draft?.parsed.accountTail).toBe('4471');
    expect(draft?.parsed.dedupeKey).toBe('ref:412703998812');
  });
});

describe('a message read from the inbox never carries its text', () => {
  const messages = [sms(SWIGGY)];
  const { candidates, chosen } = allOf(messages);
  const readKeys = new Set(candidates.map((item) => item.dedupeKey));

  it('leaves rawText null', () => {
    const [draft] = planSmsDrafts({ candidates, chosen, readKeys });
    expect(draft?.rawText).toBeNull();
    expect(draft?.parsed.channel).toBe('inbox');
  });

  it('ignores bodies it was handed by mistake', () => {
    // The rule is enforced here rather than asked of the caller: a screen that
    // built a body map for its pasted half and passed it for the whole list
    // must still not be able to leak one.
    const [draft] = planSmsDrafts({
      candidates,
      chosen,
      readKeys,
      bodies: bodiesByKey(messages),
    });
    expect(draft?.rawText).toBeNull();
  });

  it('puts no part of the message body anywhere in what will be synced', () => {
    // The payload that reaches `/sync` is this draft, field for field. Rather
    // than name the one field, look for the text anywhere in it: a future field
    // that started carrying the body would fail here too.
    const drafts = planSmsDrafts({
      candidates,
      chosen,
      readKeys,
      bodies: bodiesByKey(messages),
    });
    const wire = JSON.stringify(drafts, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(wire).not.toContain('debited');
    expect(wire).not.toContain('XX4471');
    expect(wire).not.toContain('a/c');
    // What it *does* carry is the facts: the shop, the amount, the day.
    expect(wire).toContain('SWIGGY');
    expect(wire).toContain('125000');
    expect(wire).toContain('2026-03-02');
  });

  it('treats a message that was both read and pasted as read', () => {
    // The conservative reading, deliberately: if this app went and got it, the
    // stricter rule applies however else it also arrived.
    const both = [sms(SWIGGY), sms(SWIGGY)];
    const proposed = proposeFromSms(both);
    const [draft] = planSmsDrafts({
      candidates: proposed,
      chosen: new Set(proposed.map((item) => item.dedupeKey)),
      readKeys: new Set([proposed[0]!.dedupeKey]),
      bodies: bodiesByKey(both),
    });
    expect(draft?.rawText).toBeNull();
  });
});

describe('what a draft is made of', () => {
  const messages = [sms(SWIGGY), sms(CAFE, '2026-03-03T10:00:00.000Z')];
  const { candidates, chosen } = allOf(messages);
  const drafts = planSmsDrafts({ candidates, chosen, bodies: bodiesByKey(messages) });

  it('takes the shop as the description and guesses a category from it', () => {
    const swiggy = drafts.find((draft) => draft.description === 'SWIGGY');
    expect(swiggy?.category).toBe('food');
  });

  it('files it on the day the bank said, in minor units', () => {
    const swiggy = drafts.find((draft) => draft.description === 'SWIGGY');
    expect(swiggy?.expenseDate).toBe('2026-03-02');
    expect(swiggy?.amount).toBe(125000n);
    expect(swiggy?.currency).toBe('INR');
  });

  it('leaves a message with no shop unnamed rather than inventing a word', () => {
    // The screen shows "Card payment"; the row keeps the truth, because a
    // description is a thing a person typed or a bank said.
    const bare = proposeFromSms([sms('Rs.500 debited on 02-03-26')]);
    const [draft] = planSmsDrafts({
      candidates: bare,
      chosen: new Set(bare.map((item) => item.dedupeKey)),
    });
    expect(draft?.description).toBe('');
    expect(draft?.category).toBeNull();
  });

  it('writes only what was ticked', () => {
    const one = planSmsDrafts({ candidates, chosen: new Set([candidates[0]!.dedupeKey]) });
    expect(one).toHaveLength(1);
    expect(planSmsDrafts({ candidates, chosen: new Set() })).toEqual([]);
  });
});

describe('what could not be read, counted honestly', () => {
  it('counts a block the parser refused', () => {
    expect(unreadableCount([SWIGGY, 'Your OTP is 4471. Rs.1,250 will be debited.'])).toBe(1);
  });

  it('counts money coming in — it was left out, and the screen says so', () => {
    expect(unreadableCount(['Rs.2,000 credited to a/c XX4471 from RAVI on 02-03-26'])).toBe(1);
  });

  it('does not count a duplicate as a failure', () => {
    // Two copies of one message collapse into one candidate. "Blocks minus
    // candidates" would call the second copy unreadable, which it is not.
    expect(unreadableCount([SWIGGY, SWIGGY])).toBe(0);
  });
});

describe('bodies, indexed by the key their candidate will carry', () => {
  it('lines up with what proposeFromSms produced', () => {
    const messages = [sms(SWIGGY), sms(CAFE, '2026-03-03T10:00:00.000Z')];
    const bodies = bodiesByKey(messages);
    for (const candidate of proposeFromSms(messages)) {
      expect(bodies.get(candidate.dedupeKey)).toBeTypeOf('string');
    }
  });

  it('holds nothing for a message that is not a payment', () => {
    expect(bodiesByKey([sms('Your OTP is 4471. Rs.1,250 will be debited.')]).size).toBe(0);
  });

  it('keeps the first of a duplicate pair, as the proposer does', () => {
    const bodies = bodiesByKey([sms(SWIGGY), sms(`${SWIGGY} (resent)`)]);
    expect(bodies.size).toBe(1);
    expect([...bodies.values()][0]).toBe(SWIGGY);
  });
});
