/**
 * Leaving a group with a balance asks "Settle up first" in the owner's
 * illustrated dialog. The source is pinned rather than mounting the native
 * screen, the way the settings mockup test does.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const { STRINGS_BY_LANGUAGE } = await import('../src/i18n');

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');
const DIALOG = read('src/components/SettleFirstDialog.tsx');
const SCREEN = read('src/app/group/[id]/settings.tsx');

const KEYS = [
  'settleFirst',
  'settleFirstBody',
  'settleFirstBalance',
  'leaveAnyway',
  'settleFirstSettle',
  'settleFirstBalanceLabel',
  'settleFirstClose',
] as const;

describe('settle-first dialog', () => {
  it('has its illustration asset on disk', () => {
    expect(DIALOG).toContain('assets/images/settle-first-art.webp');
    expect(existsSync(join(process.cwd(), 'assets/images/settle-first-art.webp'))).toBe(true);
  });

  it('is a centred card with a pill outline door, a brand door and a tappable balance card', () => {
    expect(DIALOG).toContain('<Popup');
    expect(DIALOG).toContain('borderRadius: 28');
    expect(DIALOG).toContain('theme.color.brandSoft');
    expect(DIALOG).toContain('theme.color.brand');
    expect(DIALOG).toContain('theme.radius.pill');
    expect(DIALOG).toContain('variant="brand"');
    expect(DIALOG).toContain("directionalIcon('chevron-forward')");
    const balanceCard = DIALOG.slice(DIALOG.indexOf('<Pressable'), DIALOG.indexOf('</Pressable>'));
    const settleButton = DIALOG.slice(DIALOG.indexOf('<Button'), DIALOG.indexOf('</Row>'));
    for (const control of [balanceCard, settleButton]) {
      expect(control).toContain('disabled={busy}');
      expect(control).toMatch(
        /onPress=\{\(\) => \{\s*if \(!pending\.current\) onSettle\(\);\s*\}\}/,
      );
    }
    expect(settleButton).toContain('label={g.settleFirstSettle}');
  });

  it('draws "Leave anyway" only when the caller passes the handler', () => {
    expect(DIALOG).toContain('onLeaveAnyway ? (');
  });

  it('labels the controls for a screen reader and keeps the art out of it', () => {
    expect(DIALOG).toContain('accessibilityLabel={fill(g.settleFirstBalanceLabel');
    expect(DIALOG).toContain('accessibilityLabel={g.leaveAnyway}');
    expect(DIALOG).toContain('accessibilityRole="header"');
    expect(DIALOG).toContain('accessible={false}');
  });

  it('draws no literal colours except the art backdrop, so dark mode follows the theme', () => {
    const withoutBackdrop = DIALOG.replace(/ART_BACKDROP = '#[0-9A-Fa-f]+'/, '');
    expect(withoutBackdrop).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });
});

describe('leave() routing in group settings', () => {
  it('shows the dialog when the balance is non-zero and the old confirm when it is zero', () => {
    const leave = SCREEN.slice(SCREEN.indexOf('const leave = async'));
    const body = leave.slice(0, leave.indexOf('// Archiving'));
    expect(body.indexOf('setSettleFirstOpen(true)')).toBeGreaterThan(-1);
    expect(body.indexOf('setSettleFirstOpen(true)')).toBeLessThan(body.indexOf('confirm({'));
    expect(body).toContain('t.group.leaveQuestion');
    expect(SCREEN).toContain('if (!settled) {');
  });

  it('sends the balance card and Settle up to the group Balances tab, and Leave anyway to the mutation', () => {
    const block = SCREEN.slice(SCREEN.indexOf('<SettleFirstDialog'));
    const dialog = block.slice(0, block.indexOf('/>'));
    expect(dialog).toMatch(
      /onSettle=\{\(\) => \{\s*setSettleFirstOpen\(false\);\s*router\.push\(settleHref\(groupId\)\);\s*\}\}/,
    );
    expect(dialog).toMatch(
      /onLeaveAnyway=\{async \(\) => \{\s*await leaveNow\(\);\s*setSettleFirstOpen\(false\);\s*\}\}/,
    );
    const leaveNow = SCREEN.slice(
      SCREEN.indexOf('const leaveNow = async'),
      SCREEN.indexOf('const leave = async'),
    );
    expect(leaveNow).toContain('if (!ledger.myMemberId || leaveGroup.isPending) return false;');
    expect(leaveNow).toContain('await leaveGroup.mutateAsync(ledger.myMemberId);');
  });

  it('is the only place that leaves a group', () => {
    expect(SCREEN.match(/leaveGroup\.mutate/g)).toHaveLength(1);
    expect(SCREEN.match(/void leave\(\)/g)).toHaveLength(1);
  });
});

describe('strings', () => {
  for (const lang of ['en', 'ta', 'hi', 'ar'] as const) {
    it(`${lang} carries every settle-first string`, () => {
      const group = STRINGS_BY_LANGUAGE[lang].group as unknown as Record<string, string>;
      for (const key of KEYS) {
        expect(group[key], `${lang}.${key}`).toBeTruthy();
      }
      expect(group.settleFirstBalanceLabel).toContain('{amount}');
    });
  }
});
