/**
 * Capture never grows a payer or a split of its own — those live on
 * add-expense, because they describe how a bill is shared among a group's
 * members, and a capture's whole reason to exist is that there may be no
 * group yet (A34). Picking a real group in the destination sheet instead
 * hands the draft straight to that group's add-expense form (the same
 * hand-off the inbox already uses to assign a capture — `captureAssign.ts`),
 * so who paid and how it's split are asked there, once, in their one honest
 * place.
 *
 * Source-reading, like `captureFactsCard.test.ts`: the screen pulls in
 * Reanimated and gesture-handler by way of `SheetOverlay`, which this
 * node-environment suite cannot mount, but the shape worth protecting — that
 * only "decide later" ever stays on this screen, and any real group leaves it
 * for add-expense — is legible in the text without any of that. The exact
 * fields the hand-off carries are covered at the unit level in
 * `captureAssign.test.ts` (`captureDraftFields` + `assignCaptureHref`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../src');
const source = (relativePath: string): string => readFileSync(join(SRC, relativePath), 'utf8');

describe('capture never asks who paid or how it is split itself', () => {
  const capture = source('app/capture.tsx');

  it('imports no payer or split control — those are add-expense-only', () => {
    // The vocabulary add-expense's own facts card and payer chooser use. None
    // of it belongs on this screen: a payer or a split control here, even
    // hidden behind a group check, would be a place to reimplement the split
    // engine rather than reuse it (packages/core), which the task guarding
    // this file forbids outright.
    expect(capture).not.toMatch(/payerChoices|PayerRow|SplitEntries|splitParams|computeShares/);
  });

  it('keeps the facts card to exactly what-for, paid-with, destination and date', () => {
    const match = capture.match(/<DetailRows>([\s\S]*?)<\/DetailRows>/);
    expect(match, 'capture should render exactly one DetailRows block').not.toBeNull();
    const block = match![1]!;
    // Four rows, not six: no fifth "who paid" or sixth "split" row ever joins
    // this block, whatever the destination row currently reads.
    const rows = block.match(/<(CategoryRow|PaymentMethodRow|DetailRow)\b/g) ?? [];
    expect(rows).toHaveLength(4);
  });

  it('hands off to add-expense, not to itself, the moment a real group is picked', () => {
    // GroupPicker's onPick: null (Decide later) is the only branch that stays
    // on this screen and merely records the choice; anything else pushes to
    // the group's own add-expense form via the exact builder the inbox's
    // assign already uses, so the two hand-offs cannot drift apart.
    const onPick = capture.match(/onPick=\{\(id\) => \{[\s\S]*?\n {12}\}\}/);
    expect(onPick, 'capture should wire GroupPicker.onPick').not.toBeNull();
    const body = onPick![0]!;
    expect(body).toMatch(/if \(id === null\) \{\s*setTargetGroupId\(null\);\s*return;\s*\}/);
    expect(body).toMatch(/router\.push\(\s*assignCaptureHref\(\s*captureDraftFields\(/);
  });

  it("builds the hand-off from this screen's own live draft, not a saved row", () => {
    expect(capture).toMatch(
      /import \{ assignCaptureHref, captureDraftFields \} from '@\/lib\/captureAssign';/,
    );
    const call = capture.match(/captureDraftFields\(\{[\s\S]*?\}\)/);
    expect(call, 'capture should call captureDraftFields with its own state').not.toBeNull();
    for (const field of [
      'captureId',
      'description',
      'amount',
      'category',
      'categoryMeta',
      'location',
      'paymentMethod',
      'date',
    ]) {
      expect(call![0]).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});
