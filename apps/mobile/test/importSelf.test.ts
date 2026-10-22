import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { importGate, maybeSelf, suggestSelf } from '@/lib/importSelf';

describe('suggestSelf', () => {
  it('matches the same name ignoring case, spacing and Latin accents', () => {
    expect(suggestSelf(['Asha', 'MADAN  d'], 'Madan D')).toBe('MADAN  d');
    expect(suggestSelf(['José', 'Asha'], 'Jose')).toBe('José');
    expect(suggestSelf(['Jose'], 'José')).toBe('Jose');
  });

  it('lets a trailing initial stand for the same surname only', () => {
    expect(suggestSelf(['Madan Dhanapal'], 'Madan D')).toBe('Madan Dhanapal');
    expect(suggestSelf(['Madan D'], 'Madan Dhanapal')).toBe('Madan D');
    expect(suggestSelf(['Madan K'], 'Madan D')).toBeNull();
    expect(suggestSelf(['Madan Kumar'], 'Madan D')).toBeNull();
  });

  it('never selects on first name or initials alone', () => {
    expect(suggestSelf(['Madan', 'Asha'], 'Madan D')).toBeNull();
    expect(suggestSelf(['MD', 'Asha'], 'Madan D')).toBeNull();
    expect(suggestSelf(['MD'], 'Mary Davis')).toBeNull();
  });

  it('suggests nothing when two names match', () => {
    expect(suggestSelf(['Madan D', 'madan d'], 'Madan D')).toBeNull();
  });

  it('suggests nothing without a name or a match', () => {
    expect(suggestSelf(['Asha', 'Ravi'], 'Madan D')).toBeNull();
    expect(suggestSelf(['Asha'], null)).toBeNull();
    expect(suggestSelf(['Asha'], '   ')).toBeNull();
  });

  it('keeps Indic vowel signs, so different names never match', () => {
    expect(suggestSelf(['करण'], 'किरण')).toBeNull();
    expect(suggestSelf(['கமர்'], 'குமார்')).toBeNull();
    expect(suggestSelf(['किरण'], 'किरण')).toBe('किरण');
    expect(suggestSelf(['குமார்'], 'குமார்')).toBe('குமார்');
  });
});

describe('maybeSelf', () => {
  it('hints on first name or initials, never as a confident match', () => {
    expect(maybeSelf(['Madan K', 'Asha'], 'Madan D')).toBe('Madan K');
    expect(maybeSelf(['MD', 'Asha'], 'Madan D')).toBe('MD');
  });
  it('stays quiet when confident, ambiguous or unrelated', () => {
    expect(maybeSelf(['Madan D', 'Madan K'], 'Madan D')).toBeNull();
    expect(maybeSelf(['Madan K', 'Madan R'], 'Madan D')).toBeNull();
    expect(maybeSelf(['Asha'], 'Madan D')).toBeNull();
  });
});

describe('importGate', () => {
  it('guides instead of importing until "you" is answered', () => {
    expect(importGate({ claimedByMe: false, notInFile: false })).toBe('needYou');
  });
  it('is ready once you are picked or not in the file', () => {
    expect(importGate({ claimedByMe: true, notInFile: false })).toBe('ready');
    expect(importGate({ claimedByMe: false, notInFile: true })).toBe('ready');
  });
});

describe('import screen source', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/settings/import.tsx'), 'utf8');
  it('asks "which one is you?" and never disables Import on it', () => {
    expect(src).toContain('t.importLedger.whichOneIsYou');
    expect(src).toContain('t.importLedger.notInFile');
    expect(src).not.toContain('selected: isMe');
    expect(src).toContain('checked: isMe');
    expect(src).toContain('checked: notInFile');
    expect(src).toContain('disabled={busy}');
    expect(src).not.toContain('disabled={busy || !claimedByMe}');
    expect(src).toContain('onPress={onImportPress}');
    expect(src).toContain('importGate(');
  });
  it('dropped the old dead-end copy', () => {
    expect(src).not.toContain('tapYourNameFirst');
    expect(src).not.toContain('tapANameNote');
  });
});
