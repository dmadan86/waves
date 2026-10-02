/**
 * `findHighlightSpans` across the markets Waves ships in first: India (₹,
 * Indian grouping), the UAE (AED, Arabic body text), the UK (£), the US ($)
 * and Australia (A$). Every case checks the actual substring matched, not
 * just the offsets — a span at the right index into the wrong characters
 * would pass an offset-only assertion and still render the wrong highlight.
 */
import { describe, expect, it } from 'vitest';

import { findHighlightSpans, type ParsedSmsFacts } from '@/lib/smsHighlights';

function spanText(body: string, span: { start: number; end: number }): string {
  return body.slice(span.start, span.end);
}

function byKind(spans: ReturnType<typeof findHighlightSpans>) {
  return Object.fromEntries(spans.map((s) => [s.kind, s]));
}

describe('findHighlightSpans — India', () => {
  it('finds a Rs.-prefixed amount with Indian grouping, a dd-Mon-yy date and the merchant', () => {
    const body = 'Rs.1,250.00 spent on your HDFC Bank Card ending 4006 at SWIGGY on 02-Oct-26.';
    const facts: ParsedSmsFacts = {
      amount: '125000',
      currency: 'INR',
      merchant: 'SWIGGY',
      occurredOn: '2026-10-02',
    };
    const spans = byKind(findHighlightSpans(body, facts));
    expect(spanText(body, spans.amount!)).toBe('1,250.00');
    expect(spanText(body, spans.date!)).toBe('02-Oct-26');
    expect(spanText(body, spans.merchant!)).toBe('SWIGGY');
  });

  it('finds lakh-grouped amounts', () => {
    const body = 'INR 1,00,000 debited from a/c for a purchase on 2 Oct 2026.';
    const facts: ParsedSmsFacts = {
      amount: '10000000',
      currency: 'INR',
      merchant: null,
      occurredOn: '2026-10-02',
    };
    const spans = byKind(findHighlightSpans(body, facts));
    expect(spanText(body, spans.amount!)).toBe('1,00,000');
    expect(spanText(body, spans.date!)).toBe('2 Oct 2026');
  });
});

describe('findHighlightSpans — UAE', () => {
  it('finds an AED amount and a numeric date inside an Arabic sentence', () => {
    const body =
      'مبلغ AED 350.00 مدين من حسابك لدى CARREFOUR بتاريخ 02/10/2026 في بنك الإمارات دبي الوطني';
    const facts: ParsedSmsFacts = {
      amount: '35000',
      currency: 'AED',
      merchant: 'CARREFOUR',
      occurredOn: '2026-10-02',
    };
    const spans = byKind(findHighlightSpans(body, facts));
    expect(spanText(body, spans.amount!)).toBe('350.00');
    expect(spanText(body, spans.merchant!)).toBe('CARREFOUR');
    expect(spanText(body, spans.date!)).toBe('02/10/2026');
  });

  it('keeps three decimal places for KWD/BHD/OMR', () => {
    const body = 'KWD 12.500 spent at a store on 02/10/2026';
    const facts: ParsedSmsFacts = {
      amount: '12500',
      currency: 'KWD',
      merchant: null,
      occurredOn: '2026-10-02',
    };
    const spans = byKind(findHighlightSpans(body, facts));
    expect(spanText(body, spans.amount!)).toBe('12.500');
  });
});

describe('findHighlightSpans — UK', () => {
  it('finds a £ amount and a "day Mon year" date', () => {
    const body = 'You spent £45.00 at TESCO on 2 Oct 2026 using card ending 1234.';
    const facts: ParsedSmsFacts = {
      amount: '4500',
      currency: 'GBP',
      merchant: 'TESCO',
      occurredOn: '2026-10-02',
    };
    const spans = byKind(findHighlightSpans(body, facts));
    expect(spanText(body, spans.amount!)).toBe('45.00');
    expect(spanText(body, spans.date!)).toBe('2 Oct 2026');
    expect(spanText(body, spans.merchant!)).toBe('TESCO');
  });
});

describe('findHighlightSpans — US', () => {
  it('finds a $ amount and a "Mon day, year" date', () => {
    const body = 'You spent $45.00 at STARBUCKS on Oct 2, 2026.';
    const facts: ParsedSmsFacts = {
      amount: '4500',
      currency: 'USD',
      merchant: 'STARBUCKS',
      occurredOn: '2026-10-02',
    };
    const spans = byKind(findHighlightSpans(body, facts));
    expect(spanText(body, spans.amount!)).toBe('45.00');
    expect(spanText(body, spans.date!)).toBe('Oct 2, 2026');
    expect(spanText(body, spans.merchant!)).toBe('STARBUCKS');
  });
});

describe('findHighlightSpans — Australia', () => {
  it('finds an A$ amount and a numeric dd/mm/yyyy date', () => {
    const body = 'A$60.00 spent at WOOLWORTHS on 02/10/2026 card ending 9988.';
    const facts: ParsedSmsFacts = {
      amount: '6000',
      currency: 'AUD',
      merchant: 'WOOLWORTHS',
      occurredOn: '2026-10-02',
    };
    const spans = byKind(findHighlightSpans(body, facts));
    expect(spanText(body, spans.amount!)).toBe('60.00');
    expect(spanText(body, spans.date!)).toBe('02/10/2026');
    expect(spanText(body, spans.merchant!)).toBe('WOOLWORTHS');
  });
});

describe('findHighlightSpans — refuses to invent a match', () => {
  it('omits the amount span when the body spells it differently than parsed', () => {
    const body = 'A payment was made at SWIGGY on 02-Oct-26.';
    const facts: ParsedSmsFacts = {
      amount: '125000',
      currency: 'INR',
      merchant: 'SWIGGY',
      occurredOn: '2026-10-02',
    };
    const spans = findHighlightSpans(body, facts);
    expect(spans.some((s) => s.kind === 'amount')).toBe(false);
  });

  it('omits the date span when no date in the body equals the parsed day', () => {
    const body = 'Rs.100 spent at a shop on 03-Oct-26.';
    const facts: ParsedSmsFacts = {
      amount: '10000',
      currency: 'INR',
      merchant: null,
      occurredOn: '2026-10-02',
    };
    const spans = findHighlightSpans(body, facts);
    expect(spans.some((s) => s.kind === 'date')).toBe(false);
  });

  it('omits the merchant span when there is no merchant', () => {
    const body = 'Rs.100 withdrawn from ATM on 02-Oct-26.';
    const facts: ParsedSmsFacts = {
      amount: '10000',
      currency: 'INR',
      merchant: null,
      occurredOn: '2026-10-02',
    };
    const spans = findHighlightSpans(body, facts);
    expect(spans.some((s) => s.kind === 'merchant')).toBe(false);
  });

  it('never matches a longer number than was parsed', () => {
    const body = 'Rs.11,250.00 spent at SWIGGY on 02-Oct-26.';
    const facts: ParsedSmsFacts = {
      amount: '125000', // 1,250.00 — a prefix of the 11,250.00 actually in the body
      currency: 'INR',
      merchant: 'SWIGGY',
      occurredOn: '2026-10-02',
    };
    const spans = findHighlightSpans(body, facts);
    expect(spans.some((s) => s.kind === 'amount')).toBe(false);
  });
});

describe('findHighlightSpans — reading order', () => {
  it('returns spans sorted by where they start, regardless of kind order', () => {
    const body = 'SWIGGY charged Rs.250 on 02-Oct-26.';
    const facts: ParsedSmsFacts = {
      amount: '25000',
      currency: 'INR',
      merchant: 'SWIGGY',
      occurredOn: '2026-10-02',
    };
    const spans = findHighlightSpans(body, facts);
    const starts = spans.map((s) => s.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(spans[0]!.kind).toBe('merchant');
  });
});
