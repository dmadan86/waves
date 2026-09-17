/**
 * What the browser is willing to put in an `href`.
 *
 * The case that matters is `javascript:`: a share link is written by one group
 * member and rendered by all the others, so a scheme that executes is stored
 * XSS. The rest of these pin the shape of the answer so a later "just let
 * relative links through" cannot quietly widen it.
 */

import { describe, expect, it } from 'vitest';

import { httpUrl } from '../src/lib/safeUrl';

describe('httpUrl', () => {
  it('passes an ordinary share link through unchanged', () => {
    const link = 'https://drive.google.com/file/d/1a2b3c/view?usp=sharing';
    expect(httpUrl(link)).toBe(link);
    expect(httpUrl('http://receipts.example.com/bill.jpg')).toBe(
      'http://receipts.example.com/bill.jpg',
    );
  });

  it('refuses a scheme that executes', () => {
    expect(httpUrl('javascript:alert(document.cookie)')).toBeNull();
    // Case and leading space are how such a value gets past a naive prefix
    // check; the URL parser normalises both, which is why it does the deciding.
    expect(httpUrl('JavaScript:alert(1)')).toBeNull();
    expect(httpUrl('  javascript:alert(1)')).toBeNull();
    expect(httpUrl('java\tscript:alert(1)')).toBeNull();
  });

  it('refuses the other schemes a link should never carry', () => {
    expect(httpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(httpUrl('vbscript:msgbox(1)')).toBeNull();
    expect(httpUrl('file:///etc/passwd')).toBeNull();
  });

  it('refuses anything that is not an absolute URL', () => {
    expect(httpUrl('/settings')).toBeNull();
    expect(httpUrl('//evil.example.com/bill.jpg')).toBeNull();
    expect(httpUrl('drive.google.com/file/d/1a2b3c')).toBeNull();
  });

  it('treats an absent link as no link', () => {
    expect(httpUrl(null)).toBeNull();
    expect(httpUrl(undefined)).toBeNull();
    expect(httpUrl('')).toBeNull();
  });
});
