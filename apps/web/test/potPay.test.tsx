import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PotPayInfo } from '@waves/api-client';

vi.mock('../src/lib/waves', () => ({ waves: {} }));
import PayPage, { metadata } from '../src/app/pay/[code]/page';
import { PotPay, PotPaymentDetails } from '../src/app/pay/[code]/PotPay';
import { potPayUri, potReportInput } from '../src/lib/potPay';
import { StringsProvider } from '../src/i18n-context';
import { Language, stringsFor } from '../src/i18n';

const info: PotPayInfo = {
  potName: 'Weekend food',
  groupName: 'Friends',
  perHeadMinor: '12550',
  currency: 'INR',
  payeeName: 'Maya',
  payeeVpa: 'maya@upi',
};
const render = (child: React.ReactNode) =>
  renderToStaticMarkup(
    <StringsProvider language={Language.En} locale="en-IN">
      {child}
    </StringsProvider>,
  );

describe('public pot payment route', () => {
  it('awaits the route code and excludes the page from indexing', async () => {
    const page = await PayPage({ params: Promise.resolve({ code: 'abc123' }) });
    expect(page.props.code).toBe('abc123');
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(render(<PotPay code="abc123" />)).toContain('Loading');
  });

  it('shows public names, amount, QR and UPI handoff without an account gate', () => {
    const html = render(<PotPaymentDetails info={info} code="abc123" />);
    expect(html).toContain('Weekend food');
    expect(html).toContain('Friends');
    expect(html).toContain('125.50');
    expect(html).toContain('Pay to Maya');
    expect(html).toContain('<svg');
    expect(html).toContain('href="upi://pay?');
    expect(html).toContain('Open UPI app');
  });

  it('offers no broken QR or handoff when UPI details cannot be used', () => {
    for (const overrides of [{ payeeVpa: null }, { payeeVpa: 'bad' }, { currency: 'USD' }]) {
      const html = render(<PotPaymentDetails info={{ ...info, ...overrides }} code="abc123" />);
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('href="upi:');
    }
  });

  it('builds the exact per-head amount and WV note through core', () => {
    const uri = new URL(potPayUri(info, 'abc123')!);
    expect(Object.fromEntries(uri.searchParams)).toMatchObject({
      pa: 'maya@upi',
      pn: 'Maya',
      am: '125.50',
      cu: 'INR',
      tn: 'WV-abc123',
    });
  });

  it('accepts optional references and normalises valid bank references', () => {
    expect(potReportInput(' Maya ', ' ')).toEqual({ name: 'Maya', reference: null });
    expect(potReportInput('Maya', ' 123456789012 ')).toEqual({
      name: 'Maya',
      reference: '123456789012',
    });
    expect(potReportInput('Maya', 'hdfc0123456789')).toEqual({
      name: 'Maya',
      reference: 'HDFC0123456789',
    });
    for (const utr of ['1234', 'UPI/123456789012', '123456789012<script>', '1'.repeat(65)]) {
      expect(potReportInput('Maya', utr)).toEqual({ error: 'badUtr' });
    }
    expect(potReportInput(' ', '')).toEqual({ error: 'badName' });
    expect(potReportInput('a'.repeat(101), '')).toEqual({ error: 'badName' });
  });

  it('describes a self-report awaiting the payee', () => {
    expect(stringsFor(Language.En).potPay.sent).toBe('Sent. {payee} will confirm it.');
  });
});
