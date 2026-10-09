/**
 * "Paid to" on the wire: absent keeps, '' clears, text is cleaned and capped.
 */

import { describe, expect, it } from 'vitest';

import { cleanPayee, PAYEE_MAX_LENGTH, payeeArgument, resolvePayee } from '../src/expense/payee';

describe('cleanPayee', () => {
  it('trims, collapses inner whitespace and turns blank into null', () => {
    expect(cleanPayee('  Car   rental \n')).toBe('Car rental');
    expect(cleanPayee('   ')).toBeNull();
    expect(cleanPayee('')).toBeNull();
    expect(cleanPayee(null)).toBeNull();
    expect(cleanPayee(undefined)).toBeNull();
  });

  it('caps at the limit without splitting a character', () => {
    expect(cleanPayee('x'.repeat(200))).toHaveLength(PAYEE_MAX_LENGTH);
    const capped = cleanPayee('🏠'.repeat(100))!;
    expect(Array.from(capped)).toHaveLength(PAYEE_MAX_LENGTH);
    expect(capped.endsWith('🏠')).toBe(true);
  });
});

describe('payeeArgument', () => {
  it('keeps "not sent" (null) apart from "cleared" (empty string)', () => {
    expect(payeeArgument(undefined)).toBeNull();
    expect(payeeArgument(null)).toBeNull();
    expect(payeeArgument('')).toBe('');
    expect(payeeArgument('   ')).toBe('');
    expect(payeeArgument(' Landlord ')).toBe('Landlord');
  });
});

describe('resolvePayee', () => {
  it('carries the previous payee forward when nothing was sent', () => {
    expect(resolvePayee(undefined, 'Landlord')).toBe('Landlord');
    expect(resolvePayee(null, 'Landlord')).toBe('Landlord');
    expect(resolvePayee(undefined, undefined)).toBeNull();
  });

  it('replaces or clears it when something was', () => {
    expect(resolvePayee('Maid', 'Landlord')).toBe('Maid');
    expect(resolvePayee('', 'Landlord')).toBeNull();
  });
});
