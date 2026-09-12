/**
 * Every note in the private ledger can be spoken.
 *
 * The mic is the whole point of the shared `PersonalNoteField`, and the way it
 * goes missing is not a broken mic — it is a new editor that writes its own
 * `TextInput` for the note, exactly as the transaction, loan and recurring-rule
 * screens each did before this. That kind of omission renders perfectly, passes
 * every type check, and is only ever noticed by somebody who used the mic on
 * the shared side and went looking for it here.
 *
 * So this reads the personal screens as source and insists a note goes through
 * the shared field. Source rather than a render: the field pulls in react-native
 * and, behind `DictateButton`, a native module, neither of which this
 * node-environment suite can load — and the thing worth protecting is a
 * structural fact about the call sites, which is legible in the text.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PERSONAL_DIR = join(__dirname, '../src/app/personal');
const SCREENS = readdirSync(PERSONAL_DIR).filter((name) => name.endsWith('.tsx'));

const source = (name: string): string => readFileSync(join(PERSONAL_DIR, name), 'utf8');

/**
 * A screen that types a note. `notePlaceholder` is the one string every note
 * box in this section shows, which makes it a more honest marker than the
 * variable name: a screen that merely *displays* a saved note (the ledger list)
 * never asks for that placeholder.
 */
const editors = SCREENS.filter((name) => source(name).includes('t.personal.notePlaceholder'));

describe('the private ledger’s note', () => {
  it('is typed on the screens this test knows about', () => {
    // A guard on the guard: if the section is restructured and nothing matches
    // any more, the assertions below would pass by looking at nothing at all.
    expect(editors.sort()).toEqual(['entry.tsx', 'loans.tsx', 'recurring.tsx']);
  });

  it('goes through the shared field on every one of them, so it carries a mic', () => {
    for (const name of editors) {
      expect(source(name), name).toContain('<PersonalNoteField');
    }
  });

  it('is never a bare TextInput carrying the note placeholder', () => {
    // The failure this catches: a note box written inline, which renders
    // identically and silently has no way to speak into it.
    for (const name of editors) {
      const inline = /<TextInput[^>]*\bt\.personal\.notePlaceholder/s.test(source(name));
      expect(inline, `${name} writes its own note field instead of PersonalNoteField`).toBe(false);
    }
  });
});

describe('the shared field', () => {
  const FIELD = readFileSync(join(__dirname, '../src/components/PersonalNoteField.tsx'), 'utf8');

  it('reaches the mic through the launch-safe wrapper, never the native module', () => {
    // Importing `expo-speech-recognition` here would throw at module load on any
    // binary built before the module existed — and because expo-router loads
    // every route file to build its tree, that throw costs the whole app at
    // launch. `DictateButton` is the guarded require that avoids it.
    expect(FIELD).toContain("from '@/components/DictateButton'");
    expect(FIELD).not.toContain('expo-speech-recognition');
  });

  it('names the box for a screen reader', () => {
    // The placeholder disappears the moment anything is typed, so it cannot be
    // the field's only description.
    expect(FIELD).toContain('accessibilityLabel={accessibilityLabel}');
  });
});
