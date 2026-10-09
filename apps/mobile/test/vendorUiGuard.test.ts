/**
 * Vendor tools (docs/event-organizer.md) belong to Event groups only. Rather
 * than have someone check every screen by hand, this scans the source: any
 * .ts/.tsx file that renders vendor UI must ask `showsVendorTools` /
 * `showsDepositRow` / `showsSubEventRow` / `showsUpcomingPayments` (src/lib/eventOrganizer.ts), unless it is on the allowlist
 * below because it can only be reached from a gated parent.
 *
 * Source-reading, like the other screen tests: these files pull in React
 * Native, which this node suite cannot mount. A reference does not prove the
 * gate is wired correctly, but it does catch the real failure: a new screen or
 * entry point that uses vendor UI and never thought about the group type.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

const MARKERS: readonly RegExp[] = [
  /\bt\.eventOrganizer\b/,
  /\bt\.eventSubEvents\b/,
  /\bVendorsBody\b/,
  /\bUpcomingPayments\b/,
  /\bSubEventBudgets\b/,
  /\bEventPlanSummary\b/,
  /\bisDeposit\b/,
  /\bbalanceDue\w*/,
  /\bTab\.Vendors\b/,
  /tab:\s*'vendors'/,
];

const GATES = /\bshows(VendorTools|DepositRow|SubEventRow|UpcomingPayments)\b/;

/** Files that render vendor UI but are only mounted by a screen that is gated. */
const ALLOWLIST: Record<string, string> = {
  'components/VendorsBody.tsx':
    'Only mounted by the group screen behind showsVendorTools (Vendors tab).',
  'components/UpcomingPayments.tsx': 'Only mounted by the plan screen behind showsVendorTools.',
  'components/SubEventBudgets.tsx':
    'Only mounted by the plan screen when showsVendorTools and the template has sub-events.',
  'components/EventPlanSummary.tsx': 'Only mounted by the plan screen behind showsVendorTools.',
  'app/new-group.tsx':
    'Creating a group: every Event control renders only once the Event type is picked.',
  'components/TripDates.tsx':
    'Shared dates card; the Event wording is chosen by the forEvent prop from new-group.',
  'i18n/index.ts': 'String tables only; renders nothing. Screens that show the copy are scanned.',
  'lib/eventDetailFacts.ts': 'Pure facts of saved data; the detail screen decides what to draw.',
  'lib/eventVendors.ts': 'Pure vendor list logic; mounted only by gated screens.',
  'lib/expenseEdit.ts': 'Seeds and builds the saved payload; the form screen is gated.',
  'lib/upcomingPayments.ts': 'Pure ordering of open deposits; used by the gated card.',
  'lib/vendorCandidates.ts': 'Pure row mapping; callers gate (plan, Vendors tab).',
  'components/GroupTypeTag.tsx': 'Names the group type itself (the Event tag); not a vendor tool.',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  rel: relative(SRC, path).split('\\').join('/'),
  text: readFileSync(path, 'utf8'),
}));
const usesVendorUi = (text: string): boolean => MARKERS.some((marker) => marker.test(text));

describe('vendor UI is gated to Event groups', () => {
  it('finds the screens that render vendor UI (the scan is not vacuous)', () => {
    const users = files.filter((file) => usesVendorUi(file.text)).map((file) => file.rel);
    expect(users).toEqual(
      expect.arrayContaining([
        'app/group/[id]/add-expense.tsx',
        'app/group/[id]/expense/[expenseId].tsx',
        'app/group/[id]/index.tsx',
        'app/group/[id]/plan.tsx',
      ]),
    );
  });

  it('every file that renders vendor UI asks the gate, or is allowlisted', () => {
    const ungated = files
      .filter((file) => usesVendorUi(file.text))
      .filter((file) => !(file.rel in ALLOWLIST) && !GATES.test(file.text))
      .map((file) => file.rel);
    expect(
      ungated,
      'These files render vendor UI without showsVendorTools/showsDepositRow (src/lib/eventOrganizer.ts). Gate them, or allowlist them with a reason if a gated parent is the only way in.',
    ).toEqual([]);
  });

  it('keeps the allowlist honest: every entry exists and still renders vendor UI', () => {
    for (const rel of Object.keys(ALLOWLIST)) {
      const file = files.find((f) => f.rel === rel);
      expect(file, `${rel} no longer exists; drop it from ALLOWLIST`).toBeDefined();
      expect(
        usesVendorUi(file!.text),
        `${rel} no longer renders vendor UI; drop it from ALLOWLIST`,
      ).toBe(true);
    }
  });
});
