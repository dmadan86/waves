import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { importGate, suggestSelf } from '@/lib/importSelf';

describe('suggestSelf', () => {
  it('matches the same name ignoring case, spacing and accents', () => {
    expect(suggestSelf(['Asha', 'MADAN  d'], 'Madan D')).toBe('MADAN  d');
    expect(suggestSelf(['José', 'Asha'], 'jose')).toBe('José');
  });

  it('falls back to a unique first name', () => {
    expect(suggestSelf(['Madan', 'Asha'], 'Madan D')).toBe('Madan');
    expect(suggestSelf(['Madan K', 'Asha'], 'Madan D')).toBe('Madan K');
  });

  it('falls back to initials as a whole name', () => {
    expect(suggestSelf(['MD', 'Asha'], 'Madan D')).toBe('MD');
  });

  it('suggests nothing when two names match', () => {
    expect(suggestSelf(['Madan K', 'Madan R'], 'Madan D')).toBeNull();
  });

  it('suggests nothing without a name or a match', () => {
    expect(suggestSelf(['Asha', 'Ravi'], 'Madan D')).toBeNull();
    expect(suggestSelf(['Asha'], null)).toBeNull();
    expect(suggestSelf(['Asha'], '   ')).toBeNull();
  });

  it('prefers an exact name over a first-name match', () => {
    expect(suggestSelf(['Madan', 'Madan D'], 'Madan D')).toBe('Madan D');
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
