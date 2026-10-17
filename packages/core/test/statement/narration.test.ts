import { describe, expect, it } from 'vitest';

import { dedupeKey, parseNarration, parseSms, referenceFor } from '../../src';

describe('parseNarration', () => {
  it.each([
    ['UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-627412345678-ORDER', 'upi', '627412345678', 'SWIGGY'],
    [
      'UPI/627412345678/Payment from PhonePe/swiggy@icici/ICICI Bank',
      'upi',
      '627412345678',
      'swiggy',
    ],
    [
      'TO TRANSFER-UPI/DR/627412345678/SWIGGY/ICIC/swiggy@icici/Payment',
      'upi',
      '627412345678',
      'SWIGGY',
    ],
    ['UPI/P2M/627412345678/SWIGGY/Payment', 'upi', '627412345678', 'SWIGGY'],
    ['UPI/SWIGGY/627412345678/Payment for order', 'upi', '627412345678', 'SWIGGY'],
    ['IMPS-627612345680-RAVI KUMAR-HDFC-XXXXXXXX1234-GIFT', 'imps', '627612345680', 'RAVI KUMAR'],
    ['IMPS/P2A/627612345680/RAVI KUMAR/HDFC/GIFT', 'imps', '627612345680', 'RAVI KUMAR'],
    [
      'NEFT CR-HDFC0000001-ACME LTD-SALARY OCT-HDFCN52026100212345',
      'neft',
      'HDFCN52026100212345',
      'ACME LTD',
    ],
    [
      'BY TRANSFER-NEFT*SBIN0000001*SBINR52026100212345*ACME LTD--',
      'neft',
      'SBINR52026100212345',
      'ACME LTD',
    ],
    ['RTGS-HDFCR52026100212345-ACME LTD', 'rtgs', 'HDFCR52026100212345', 'ACME LTD'],
  ])('%s', (text, kind, ref, who) => {
    expect(parseNarration(text)).toEqual({ kind, ref, counterparty: who });
  });

  it('reads a cheque number and does not mistake an IFSC for a UTR', () => {
    expect(parseNarration('CHQ PAID-MICR-000123-ACME TRADERS').ref).toBeNull();
    expect(parseNarration('CHEQUE NO 000123 DEPOSIT').ref).toBe('000123');
    expect(parseNarration('NEFT CR-HDFC0000001-ACME').ref).toBeNull();
  });

  it('has no reference for cash and card narrations', () => {
    expect(parseNarration('ATW-401234XXXXXX1234-S1ABC123-MUMBAI')).toMatchObject({
      kind: 'atm',
      ref: null,
    });
    expect(parseNarration('POS 401234XXXXXX1234 BIG BAZAAR')).toMatchObject({
      kind: 'pos',
      ref: null,
      counterparty: 'BIG BAZAAR',
    });
  });
});

describe('referenceFor', () => {
  it('prefers a real printed reference, unpadded when it is a padded RRN', () => {
    expect(referenceFor('0000627412345678', 'anything')).toBe('627412345678');
    expect(referenceFor('HDFCN52026100212345', 'x')).toBe('HDFCN52026100212345');
  });

  it('treats a column of zeros as none and falls back to the narration', () => {
    expect(referenceFor('0000000000000000', 'UPI/P2M/627412345678/SWIGGY')).toBe('627412345678');
    expect(referenceFor('', 'ATM CASH')).toBeNull();
  });
});

describe('the shared key with SMS drafts', () => {
  it('gives a statement row the same key the bank SMS for it gets', () => {
    const sms = parseSms(
      'Rs.450.00 debited from A/c XX1234 on 01-10-26 to SWIGGY. UPI Ref No 627412345678. Not you? Call 1800.',
    );
    expect(sms?.reference).toBe('627412345678');
    const smsKey = dedupeKey(sms!, '2026-10-01T10:00:00.000Z');
    const row = parseNarration('UPI/P2M/627412345678/SWIGGY/Payment').ref;
    expect(`ref:${row}`).toBe(smsKey);
  });
});
