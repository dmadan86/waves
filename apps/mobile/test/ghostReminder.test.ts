import { describe, expect, it } from 'vitest';

import {
  GhostChannel,
  ghostChannel,
  ghostReminderMessage,
  ghostReminderPlan,
  mailtoUrl,
  phoneDigits,
  smsUrl,
  whatsappAppUrl,
  whatsappWebUrl,
} from '../src/lib/ghostReminder';

const MESSAGE = 'Hi Matt, you owe €25.00 & ₹2,952.50: https://waves.app/j/abc?x=1';
const ENCODED = encodeURIComponent(MESSAGE);

describe('phoneDigits', () => {
  it('keeps only the digits of an E.164 number', () => {
    expect(phoneDigits('+91 98765-43210')).toBe('919876543210');
    expect(phoneDigits('(044) 1234')).toBe('0441234');
    expect(phoneDigits(null)).toBe('');
    expect(phoneDigits(undefined)).toBe('');
  });
});

describe('ghostChannel', () => {
  it('prefers a phone, then an email, then the share sheet', () => {
    expect(ghostChannel({ phone: '+15551234567', email: 'a@b.co' })).toBe(GhostChannel.WhatsApp);
    expect(ghostChannel({ phone: null, email: 'a@b.co' })).toBe(GhostChannel.Email);
    expect(ghostChannel({ phone: '  ', email: ' ' })).toBe(GhostChannel.Share);
    expect(ghostChannel({ email: 'not-an-email' })).toBe(GhostChannel.Share);
    expect(ghostChannel({})).toBe(GhostChannel.Share);
  });
});

describe('urls', () => {
  it('builds WhatsApp app and web links with the digits and an encoded message', () => {
    expect(whatsappAppUrl('+44 7700 900123', MESSAGE)).toBe(
      `whatsapp://send?phone=447700900123&text=${ENCODED}`,
    );
    expect(whatsappWebUrl('+44 7700 900123', MESSAGE)).toBe(
      `https://wa.me/447700900123?text=${ENCODED}`,
    );
  });

  it('builds SMS with the platform body separator and the + kept', () => {
    expect(smsUrl('+15551234567', MESSAGE, 'ios')).toBe(`sms:+15551234567&body=${ENCODED}`);
    expect(smsUrl('+15551234567', MESSAGE, 'android')).toBe(`sms:+15551234567?body=${ENCODED}`);
  });

  it('builds mailto with an encoded subject and body', () => {
    expect(mailtoUrl(' a@b.co ', 'Trip & co', MESSAGE)).toBe(
      `mailto:a@b.co?subject=Trip%20%26%20co&body=${ENCODED}`,
    );
  });

  it('encodes characters that would break the query', () => {
    expect(whatsappAppUrl('+1', 'a&text=b #c')).toBe(
      'whatsapp://send?phone=1&text=a%26text%3Db%20%23c',
    );
  });
});

describe('ghostReminderPlan', () => {
  const phone = '+919876543210';

  it('tries WhatsApp, then SMS, then wa.me on Android', () => {
    expect(ghostReminderPlan({ phone }, MESSAGE, 's', 'android')).toEqual([
      whatsappAppUrl(phone, MESSAGE),
      smsUrl(phone, MESSAGE, 'android'),
      whatsappWebUrl(phone, MESSAGE),
    ]);
  });

  it('tries WhatsApp, then wa.me, then SMS on iOS, ignoring the email', () => {
    expect(ghostReminderPlan({ phone, email: 'a@b.co' }, MESSAGE, 's', 'ios')).toEqual([
      whatsappAppUrl(phone, MESSAGE),
      whatsappWebUrl(phone, MESSAGE),
      smsUrl(phone, MESSAGE, 'ios'),
    ]);
  });

  it('mails when there is only an email', () => {
    expect(ghostReminderPlan({ email: 'a@b.co' }, MESSAGE, 'Subj', 'ios')).toEqual([
      mailtoUrl('a@b.co', 'Subj', MESSAGE),
    ]);
  });

  it('leaves it to the share sheet with neither', () => {
    expect(ghostReminderPlan({}, MESSAGE, 'Subj', 'android')).toEqual([]);
  });
});

describe('ghostReminderMessage', () => {
  it('fills every placeholder', () => {
    expect(
      ghostReminderMessage('Hi {name}, {amount} in {group}: {link}', {
        name: 'Matt',
        amount: '€25.00',
        group: 'Goa',
        link: 'https://x/j/1',
      }),
    ).toBe('Hi Matt, €25.00 in Goa: https://x/j/1');
  });
});
