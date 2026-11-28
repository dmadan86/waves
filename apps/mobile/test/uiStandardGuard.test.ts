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

const MIGRATE = 'not yet migrated: follow-up PR';
const IN_FLIGHT =
  'owned by an in-flight branch (planning-compact or calm redesign): migrate after it merges';

const RULES: Record<string, { test: (text: string) => boolean; legacy: Record<string, string> }> = {
  'per-row cards (use ListCard + ListItem)': {
    test: perRowCard,
    legacy: {
      'app/companies.tsx': MIGRATE,
      'app/friends/contacts.tsx': MIGRATE,
      'app/friends/person/[key]/settle.tsx': MIGRATE,
      'app/friends/person/[key].tsx': MIGRATE,
      'app/group/[id]/add-bills.tsx': MIGRATE,
      'app/group/[id]/company-vendor-order.tsx': MIGRATE,
      'app/group/[id]/families.tsx': MIGRATE,
      'app/group/[id]/income-edit.tsx': MIGRATE,
      'app/group/[id]/itemize.tsx': MIGRATE,
      'app/group/[id]/recap.tsx': MIGRATE,
      'app/group/[id]/recurring.tsx': MIGRATE,
      'app/group/[id]/settings.tsx': MIGRATE,
      'app/investments/index.tsx': MIGRATE,
      'app/settings/archived.tsx': MIGRATE,
      'app/settings/credits.tsx': MIGRATE,
      'app/settings/network-activity.tsx': MIGRATE,
      'app/settings/pending-changes.tsx': MIGRATE,
      'app/settings/phones.tsx': MIGRATE,
      'app/vehicles/[id].tsx': MIGRATE,
    },
  },
  'hand-drawn row dividers (use ListCard + ListItem)': {
    test: adHocRowDivider,
    legacy: {
      'app/(tabs)/friends.tsx': MIGRATE,
      'app/activity.tsx': MIGRATE,
      'app/group/[id]/departed/[memberId].tsx': MIGRATE,
      'app/group/[id]/index.tsx': MIGRATE,
      'app/personal/loans.tsx': IN_FLIGHT,
      'app/rentals/[id].tsx': MIGRATE,
      'app/settings/import.tsx': MIGRATE,
      'app/settings/licenses.tsx': MIGRATE,
      'app/vehicles/[id].tsx': MIGRATE,
    },
  },
  'hand-drawn cards (use StandardCard / ListCard)': {
    test: adHocCard,
    legacy: {
      'app/(tabs)/captures.tsx': MIGRATE,
      'app/(tabs)/friends.tsx': MIGRATE,
      'app/activity.tsx': MIGRATE,
      'app/captures/messages.tsx': MIGRATE,
      'app/captures/paste.tsx': MIGRATE,
      'app/captures/sms/[key].tsx': MIGRATE,
      'app/friends/find.tsx': MIGRATE,
      'app/friends/person/[key]/settle.tsx': MIGRATE,
      'app/group/[id]/add-expense.tsx': MIGRATE,
      'app/group/[id]/company-bill-form.tsx': MIGRATE,
      'app/group/[id]/company-client-add.tsx': MIGRATE,
      'app/group/[id]/company-entry.tsx': MIGRATE,
      'app/group/[id]/company-upcoming.tsx': MIGRATE,
      'app/group/[id]/company-wages.tsx': MIGRATE,
      'app/group/[id]/departed/[memberId].tsx': MIGRATE,
      'app/group/[id]/families.tsx': MIGRATE,
      'app/group/[id]/index.tsx': MIGRATE,
      'app/group/[id]/invite.tsx': MIGRATE,
      'app/group/[id]/members.tsx': MIGRATE,
      'app/group/[id]/settings.tsx': MIGRATE,
      'app/groups.tsx': MIGRATE,
      'app/investments/index.tsx': MIGRATE,
      'app/join.tsx': MIGRATE,
      'app/new-company.tsx': MIGRATE,
      'app/new-group.tsx': MIGRATE,
      'app/personal/accounts.tsx': MIGRATE,
      'app/personal/budgets.tsx': IN_FLIGHT,
      'app/personal/loans.tsx': IN_FLIGHT,
      'app/personal/spending.tsx': MIGRATE,
      'app/personal/upcoming.tsx': MIGRATE,
      'app/phone.tsx': MIGRATE,
      'app/settings/account.tsx': MIGRATE,
      'app/settings/backup.tsx': MIGRATE,
      'app/settings/delete-account.tsx': MIGRATE,
      'app/settings/import.tsx': MIGRATE,
      'app/settings/invite.tsx': MIGRATE,
      'app/settings/notifications.tsx': MIGRATE,
      'app/settings/packs/[slug].tsx': MIGRATE,
      'app/settings/paying.tsx': MIGRATE,
      'app/settings/pending-changes.tsx': MIGRATE,
      'app/settings/storage.tsx': MIGRATE,
      'app/settings/upgrade.tsx': MIGRATE,
      'app/settle-up.tsx': MIGRATE,
      'app/start.tsx': MIGRATE,
      'app/voice.tsx': MIGRATE,
      'app/welcome.tsx': MIGRATE,
    },
  },
  'own screen header (use the standard header)': {
    test: ownHeader,
    legacy: {
      'app/(tabs)/captures.tsx': MIGRATE,
      'app/friends/merge.tsx': MIGRATE,
      'app/friends/person/[key]/settle.tsx': MIGRATE,
      'app/group/[id]/add-expense.tsx': MIGRATE,
      'app/group/[id]/budget.tsx': MIGRATE,
      'app/new-group.tsx': MIGRATE,
      'app/personal/setup.tsx': MIGRATE,
      'app/start.tsx': MIGRATE,
      'app/welcome.tsx': MIGRATE,
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
