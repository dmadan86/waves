/**
 * Plain words for what a bank message says.
 *
 * Every case here came off a real screenshot of the paste screen: rows headed
 * `919951860002 Axis Bank` and `9215676766`, subtitled `JM-ICICIT-S` and
 * `AX-AIRDUE-S`. The rule these pin is the same one in both directions — when
 * this module does not know, it says nothing, because a code shown to a person
 * is worse than a blank.
 */

import { describe, expect, it } from 'vitest';

import { bankFromSender, bankFromText, merchantName } from '@/lib/smsPlain';

describe('a sender header becomes a bank', () => {
  it('strips the operator prefix and the message-type suffix', () => {
    expect(bankFromSender('JM-ICICIT-S')).toBe('ICICI Bank');
    expect(bankFromSender('AX-AXISBK-S')).toBe('Axis Bank');
    expect(bankFromSender('AD-HDFCBK')).toBe('HDFC Bank');
    expect(bankFromSender('VM-SBIINB-T')).toBe('State Bank of India');
  });

  it('takes a header with no operator prefix at all', () => {
    expect(bankFromSender('HDFCBK')).toBe('HDFC Bank');
    expect(bankFromSender('kotakb')).toBe('Kotak Mahindra Bank');
  });

  it('says nothing for a sender it does not recognise', () => {
    // A phone bill reminder rides the same rails as a bank alert. Printing
    // "AIRDUE" under a payment would teach a person that this screen speaks in
    // codes, which is exactly the habit being unlearned here.
    expect(bankFromSender('AX-AIRDUE-S')).toBeNull();
    expect(bankFromSender('VK-SOMEONE')).toBeNull();
  });

  it('says nothing for a number, which is somebody phoning, not a bank', () => {
    expect(bankFromSender('919951860002')).toBeNull();
    expect(bankFromSender('9215676766')).toBeNull();
  });

  it('says nothing for nothing', () => {
    expect(bankFromSender(null)).toBeNull();
    expect(bankFromSender('')).toBeNull();
  });
});

describe('a pasted message names its own bank', () => {
  it('finds the bank in the text, where a paste has no sender to give', () => {
    expect(bankFromText('ICICI Bank Acct XX123 debited for Rs 450')).toBe('ICICI Bank');
    expect(bankFromText('Rs.1,250 debited from your Axis Bank card')).toBe('Axis Bank');
  });

  it('does not read a shop as a bank', () => {
    expect(bankFromText('Rs.200 paid at CITI BAKERY')).toBeNull();
    expect(bankFromText('Rs.90 paid at CAFE')).toBeNull();
  });
});

describe('a merchant is only shown when it is plausibly a name', () => {
  it('keeps a name', () => {
    expect(merchantName('SWIGGY')).toBe('SWIGGY');
    expect(merchantName('Blue Tokai Coffee')).toBe('Blue Tokai Coffee');
    expect(merchantName(' AMAZON.IN ')).toBe('AMAZON.IN');
  });

  it('keeps a wallet somebody really did pay', () => {
    expect(merchantName('PAYTM')).toBe('PAYTM');
  });

  it('refuses a phone number', () => {
    expect(merchantName('9215676766')).toBeNull();
    expect(merchantName('+91 99518 60002')).toBeNull();
  });

  it('refuses a number with a bank stuck to it', () => {
    expect(merchantName('919951860002 Axis Bank')).toBeNull();
  });

  it('refuses a fragment of bank grammar', () => {
    for (const junk of ['VPA', 'A', 'UPI', 'REF', 'a/c', 'Your']) {
      expect(merchantName(junk)).toBeNull();
    }
  });

  it('refuses the bank that sent the message, which is not who was paid', () => {
    expect(merchantName('Axis Bank')).toBeNull();
    expect(merchantName('HDFC Bank')).toBeNull();
  });

  it('keeps a real place whose name happens to contain a bank word', () => {
    expect(merchantName('Bank Street Cafe')).toBe('Bank Street Cafe');
  });

  it('says nothing for nothing', () => {
    expect(merchantName(null)).toBeNull();
    expect(merchantName('   ')).toBeNull();
    expect(merchantName('...')).toBeNull();
  });
});
