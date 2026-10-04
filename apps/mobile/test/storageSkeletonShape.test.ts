/**
 * The Storage screen's loading placeholder used to be a generic two-row
 * `SkeletonList` — nothing like the meter card and perks card the screen
 * actually loads into, so the swap from "loading" to "loaded" visibly
 * reflowed the page. The fix is to render the same shape (`MeterCard`, then
 * the perks `SoftCard`) whether or not the data has arrived, and only
 * crossfade the handful of values that depend on it.
 *
 * Source-reading, like `screenHeroShape.test.ts`: this screen pulls in
 * Reanimated by way of its crossfade, which this node-environment suite
 * cannot mount (see `vitest.config.ts`), but "does the loading state share
 * the loaded state's shape" is legible in the text without any of that.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const screen = readFileSync(join(__dirname, '../src/app/settings/storage.tsx'), 'utf8');

describe('the Storage skeleton mirrors the loaded screen', () => {
  it('no longer reaches for the generic list skeleton', () => {
    // `SkeletonList` is a stand-in for an unrelated row list (avatar, two
    // text lines, a trailing amount) — nothing like this screen's meter card
    // and perks card. Its reappearance would mean the mismatch is back.
    expect(screen).not.toMatch(/SkeletonList/);
    expect(screen).not.toMatch(/from '@\/components\/Skeletons'/);
  });

  it('renders the meter card and the perks card for every loading state, not a card of their own', () => {
    // `isPaid === undefined` (still checking who pays) and `usage.isLoading`
    // (still checking the bytes) must both fall through to the same
    // `<MeterCard>…<SoftCard>` shape the loaded screen ends on — not an
    // early return with its own layout, which is exactly how the jump crept
    // back in once before.
    const body = screen.match(/const body = \(\) => \{[\s\S]*?\n {2}\};/);
    expect(body, 'storage.tsx should define body()').not.toBeNull();
    const text = body![0];

    // Only two returns stand apart from the shared shape: the paid/no-R2
    // "Unlimited" statement, and the no-data error card. Counting them pins
    // the shared shape from growing a third early return by accident.
    const earlyReturns = text.match(/^\s*return \(/gm) ?? [];
    expect(earlyReturns).toHaveLength(3);

    expect(text).toMatch(/<MeterCard\b/);
    expect(text).toMatch(/<SoftCard>/);
    expect(text).toMatch(/<MeterValues\b/);
  });

  it('keeps the perks and the upgrade button real and unconditional — they never depend on the usage query', () => {
    // These are the screen's "static chrome": titles, perk rows, the upgrade
    // button. None of them read `usage.data` or `usage.isLoading`, so they
    // render on the very first frame rather than waiting behind a skeleton.
    const soft = screen.match(/<SoftCard>[\s\S]*?<\/SoftCard>/);
    expect(soft, 'storage.tsx should render the perks card').not.toBeNull();
    expect(soft![0]).not.toMatch(/usage\.(data|isLoading|isError)/);
    expect(soft![0]).toMatch(/<Perk\b/);
    expect(soft![0]).toMatch(/t\.storage\.upgrade/);
  });

  it('gives the loading note the same row as the real one, not an absent banner', () => {
    // `MeterCard`'s note banner only renders its `Row` at all when `note` is
    // truthy — so the loading pass must still hand it something (a skeleton
    // line), or the banner itself would be the thing that pops in once data
    // arrives.
    const note = screen.match(/note=\{[\s\S]*?\n {8}\}/);
    expect(note, 'the free-tier MeterCard should pass a note').not.toBeNull();
    expect(note![0]).toMatch(/<Skeleton\b/);
  });

  it('crossfades the figures instead of swapping them with a cut', () => {
    const values = screen.match(/function MeterValues\([\s\S]*?\n\}\n\n[\s\S]*?One thing/);
    expect(values, 'storage.tsx should define MeterValues').not.toBeNull();
    const text = values![0];
    expect(text).toMatch(/useCrossfade\(ready/);
    expect(text).toMatch(/reveal\.fromStyle/);
    expect(text).toMatch(/reveal\.toStyle/);
    // The skeleton's own bar matches the real bar's height and radius — the
    // compact 6pt bar this screen tightened down to — so revealing the real
    // one never changes the card's box.
    expect(text).toMatch(/Skeleton width="100%" height=\{6\} radius=\{3\}/);
    expect(text).toMatch(/height: 6,[\s\S]*?borderRadius: 3,/);
  });

  it('imports the crossfade hook from the shared motion module, not a one-off', () => {
    expect(screen).toMatch(/import \{ useCrossfade \} from '@\/lib\/anim';/);
  });
});
