/**
 * Lists, cards and headers come from the standard components (docs/design-standard.md, Rules).
 *
 * Scans src/app so a new screen cannot draw its own list row, card or header. Files in LEGACY
 * predate the rule and are migrated in follow-up PRs; each entry must still offend (a migrated
 * file is removed from the list, never left behind), and none may be added without a reason.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

const files = sources(join(SRC, 'app')).map((p) => [relative(SRC, p), readFileSync(p, 'utf8')]);

/** A per-row card: a Card/StandardCard opened within a `.map(` callback. */
function perRowCard(text: string): boolean {
  const re = /\.map\(\s*\(?[\w{}, ]*\)?\s*=>[\s\S]{0,400}?<(StandardCard|Card)\b/g;
  return re.test(text);
}

/** A hand-drawn row divider: a border switched on the row's position. */
function adHocRowDivider(text: string): boolean {
  return /border(Top|Bottom)Width:\s*(first|last|isLast|isFirst|index|i|!first|!last|divider)\b/.test(
    text,
  );
}

/** A hand-drawn card: a plain View with the surface fill and a 12-24 corner. */
function adHocCard(text: string): boolean {
  return /<View\s+style=\{\{[^}]*?(borderRadius:\s*(1[2-9]|2\d|theme\.radius\.(lg|xl)))[^}]*?\}\}/.test(
    text,
  );
}

/** A screen that draws its own header text instead of a standard header. */
function ownHeader(text: string): boolean {
  return (
    /accessibilityRole="header"/.test(text) &&
    !/(PlainHeader|ScenicHeader|PhotoHeader|DashHeader|TabHeader|PlanningHeader)/.test(text)
  );
}

const EXCEPTION =
  'not a list row: a form, editor, wizard, summary or hero card that matches the heuristic';
const PARTIAL = 'partly migrated: the rest needs a ListItem radio role, dimming or tint support';
const HEADER = 'own header: moves to the standard header in the headers PR';
const IN_FLIGHT =
  'owned by an in-flight branch (planning-compact or calm redesign): migrate after it merges';

const RULES: Record<string, { test: (text: string) => boolean; legacy: Record<string, string> }> = {
  'per-row cards (use ListCard + ListItem)': {
    test: perRowCard,
    legacy: {
      'app/friends/contacts.tsx': EXCEPTION,
      'app/group/[id]/add-bills.tsx': EXCEPTION,
      'app/group/[id]/company-vendor-order.tsx': EXCEPTION,
      'app/group/[id]/income-edit.tsx': EXCEPTION,
      'app/group/[id]/itemize.tsx': EXCEPTION,
      'app/group/[id]/recap.tsx': EXCEPTION,
      'app/group/[id]/settings.tsx': EXCEPTION,
      'app/settings/credits.tsx': EXCEPTION,
      'app/settings/pending-changes.tsx': EXCEPTION,
      'app/vehicles/[id].tsx': EXCEPTION,
    },
  },
  'hand-drawn row dividers (use ListCard + ListItem)': {
    test: adHocRowDivider,
    legacy: {
      'app/group/[id]/index.tsx': PARTIAL,
      'app/settings/import.tsx': PARTIAL,
    },
  },
  'hand-drawn cards (use StandardCard / ListCard)': {
    test: adHocCard,
    legacy: {
      'app/group/[id]/company-client-add.tsx': EXCEPTION,
      'app/group/[id]/company-entry.tsx': EXCEPTION,
      'app/group/[id]/company-wages.tsx': EXCEPTION,
      'app/group/[id]/members.tsx': PARTIAL,
      'app/investments/index.tsx': PARTIAL,
      'app/join.tsx': EXCEPTION,
      'app/new-company.tsx': EXCEPTION,
      'app/new-group.tsx': EXCEPTION,
      'app/personal/budgets.tsx': IN_FLIGHT,
      'app/personal/loans.tsx': EXCEPTION,
      'app/phone.tsx': EXCEPTION,
      'app/settings/delete-account.tsx': EXCEPTION,
      'app/settings/invite.tsx': EXCEPTION,
      'app/start.tsx': EXCEPTION,
      'app/voice.tsx': EXCEPTION,
      'app/welcome.tsx': EXCEPTION,
    },
  },
  'own screen header (use the standard header)': {
    test: ownHeader,
    legacy: {
      'app/(tabs)/captures.tsx': HEADER,
      'app/friends/merge.tsx': HEADER,
      'app/friends/person/[key]/settle.tsx': HEADER,
      'app/group/[id]/add-expense.tsx': HEADER,
      'app/group/[id]/budget.tsx': HEADER,
      'app/new-group.tsx': HEADER,
      'app/personal/setup.tsx': HEADER,
      'app/start.tsx': HEADER,
      'app/welcome.tsx': HEADER,
    },
  },
};

describe('lists, cards and headers use the standard components', () => {
  for (const [name, rule] of Object.entries(RULES)) {
    it(`no new ${name}`, () => {
      const offenders = files
        .filter(([path, text]) => rule.test(text) && !(path in rule.legacy))
        .map(([path]) => path);
      expect(offenders).toEqual([]);
    });
    it(`every legacy entry for ${name} still offends`, () => {
      const stale = Object.keys(rule.legacy).filter((path) => {
        const found = files.find(([file]) => file === path);
        return !found || !rule.test(found[1]);
      });
      expect(stale).toEqual([]);
    });
  }
});
