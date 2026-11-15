import { describe, expect, it } from 'vitest';

import {
  companyFileType,
  filterCompanyFiles,
  normaliseLinkUrl,
  uploadMime,
  visibilityChoices,
} from '../src/company/files';

describe('company files helpers', () => {
  it('classifies by mime, then by extension', () => {
    expect(companyFileType({ kind: 'file', name: 'a', mime: 'application/pdf' })).toBe('documents');
    expect(companyFileType({ kind: 'file', name: 'a.XLSX' })).toBe('sheets');
    expect(companyFileType({ kind: 'file', name: 'a', mime: 'image/png' })).toBe('images');
    expect(companyFileType({ kind: 'file', name: 'a.zip' })).toBe('others');
    expect(companyFileType({ kind: 'file', name: 'noext' })).toBe('others');
    expect(companyFileType({ kind: 'link', name: 'Drive' })).toBe('links');
  });

  it('filters by pill and search', () => {
    const items = [
      { kind: 'file', name: 'Site_Report.pdf', mime: 'application/pdf' },
      { kind: 'file', name: 'Costs.xlsx' },
      { kind: 'link', name: 'Site plan' },
    ] as const;
    expect(filterCompanyFiles(items, 'all', '')).toHaveLength(3);
    expect(filterCompanyFiles(items, 'sheets', '').map((i) => i.name)).toEqual(['Costs.xlsx']);
    expect(filterCompanyFiles(items, 'all', ' SITE ').map((i) => i.name)).toEqual([
      'Site_Report.pdf',
      'Site plan',
    ]);
    expect(filterCompanyFiles(items, 'links', 'report')).toEqual([]);
  });

  it('picks an upload mime the server accepts', () => {
    expect(uploadMime('x.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(uploadMime('x.bin', 'application/octet-stream')).toBeNull();
    expect(uploadMime('x.jpeg', 'image/jpeg')).toBe('image/jpeg');
  });

  it('only allows http(s) links and adds https when missing', () => {
    expect(normaliseLinkUrl('drive.google.com/x')).toBe('https://drive.google.com/x');
    expect(normaliseLinkUrl(' http://a.io ')).toBe('http://a.io');
    expect(normaliseLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseLinkUrl('data:text/html,x')).toBeNull();
    expect(normaliseLinkUrl('ftp://a.io')).toBeNull();
    expect(normaliseLinkUrl('a b')).toBeNull();
    expect(normaliseLinkUrl('')).toBeNull();
    expect(normaliseLinkUrl('https://')).toBeNull();
  });

  it('keeps managers from choosing owners-only', () => {
    expect(visibilityChoices('manager')).toEqual(['everyone', 'managers']);
    expect(visibilityChoices('admin')).toContain('owners');
  });
});
