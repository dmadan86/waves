/**
 * Motion, chip rules and contrast (MC-UI-*).
 *
 *  MC-UI-01  Reduce Motion leaves opacity-only configs
 *  MC-UI-02  chip labels cut at 24 characters
 *  MC-UI-03  chips carry a hit slop and the raised height
 *  MC-UI-04  haptics stay silent without the native module and never throw
 *  MC-UI-05  chip and card text clears 4.5:1 in both themes (and glyphs 3:1)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { darkTheme, lightTheme, type Theme } from '@waves/ui/themes';

import {
  CHIP_HEIGHT,
  CHIP_HIT_SLOP,
  CHIP_LABEL_MAX,
  REDUCED_DURATION_MS,
  UNDO_RING_MS,
  cardCollapse,
  checkPop,
  chipLabel,
  isOpacityOnly,
  questionEnter,
  questionSwap,
  undoRing,
  undoRingProgress,
} from '../src/lib/assistantMotion';

const h = vi.hoisted(() => ({ os: 'ios' }));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return h.os;
    },
  },
}));

describe('MC-UI-01 motion under Reduce Motion', () => {
  const makers = { questionEnter, questionSwap, cardCollapse, checkPop };

  for (const [name, make] of Object.entries(makers)) {
    it(`${name} is a short fade and nothing else`, () => {
      const config = make(true);
      expect(isOpacityOnly(config)).toBe(true);
      expect(config.durationMs).toBe(REDUCED_DURATION_MS);
      expect(config.opacity).toEqual([0, 1]);
      expect(config.translateY[0]).toBe(config.translateY[1]);
      expect(config.scale).toEqual([1, 1]);
      expect(config.animatesHeight).toBe(false);
    });
  }

  it('keeps the spec timings when motion is allowed', () => {
    expect(questionEnter(false)).toMatchObject({ durationMs: 160, translateY: [8, 0] });
    expect(questionSwap(false)).toMatchObject({ durationMs: 120 });
    expect(cardCollapse(false)).toMatchObject({ durationMs: 180, animatesHeight: true });
    expect(checkPop(false)).toMatchObject({ durationMs: 120, scale: [0.6, 1] });
    // The swap is a cross-fade by design: opacity only even when motion is allowed.
    expect(isOpacityOnly(questionSwap(false))).toBe(true);
    for (const make of [questionEnter, cardCollapse, checkPop])
      expect(isOpacityOnly(make(false))).toBe(false);
  });

  it('draws the Undo ring full and still under Reduce Motion, draining over 6 s otherwise', () => {
    expect(undoRing(true)).toEqual({ durationMs: UNDO_RING_MS, size: 16, animated: false });
    expect(undoRing(false)).toEqual({ durationMs: 6000, size: 16, animated: true });
    expect(undoRingProgress(0)).toBe(1);
    expect(undoRingProgress(3000)).toBeCloseTo(0.5);
    expect(undoRingProgress(6000)).toBe(0);
    expect(undoRingProgress(9000)).toBe(0);
    expect(undoRingProgress(Number.NaN)).toBe(1);
  });
});

describe('MC-UI-02 chip label truncation', () => {
  it('leaves a label of 24 characters or fewer alone', () => {
    expect(chipLabel('Blue Tokai')).toBe('Blue Tokai');
    expect(chipLabel('x'.repeat(CHIP_LABEL_MAX))).toBe('x'.repeat(24));
  });

  it('cuts a longer one to 24 characters including the ellipsis', () => {
    const cut = chipLabel('Phoenix Marketcity Mall, Kurla West');
    expect(Array.from(cut)).toHaveLength(24);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.startsWith('Phoenix Marketcity')).toBe(true);
  });

  it('counts characters, not UTF-16 units, so a Tamil or emoji name is not split', () => {
    const cut = chipLabel('🍽'.repeat(30));
    expect(Array.from(cut)).toHaveLength(24);
    expect(cut).toBe(`${'🍽'.repeat(23)}…`);
  });

  it('collapses runs of whitespace before measuring', () => {
    expect(chipLabel('  Blue    Tokai  ')).toBe('Blue Tokai');
  });
});

describe('MC-UI-03 chip size and hit slop', () => {
  it('is 40 high with a 4 point slop on every side', () => {
    expect(CHIP_HEIGHT).toBe(40);
    expect(CHIP_HIT_SLOP).toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
  });
});

describe('MC-UI-04 haptics', () => {
  const stub = () => ({
    selectionAsync: vi.fn(async () => undefined),
    notificationAsync: vi.fn(async () => undefined),
    impactAsync: vi.fn(async () => undefined),
    NotificationFeedbackType: { Success: 'success' },
    ImpactFeedbackStyle: { Light: 'light' },
  });

  beforeEach(() => {
    h.os = 'ios';
  });

  it('plays selection, success and a light impact through expo-haptics', async () => {
    const module = stub();
    const haptics = await import('../src/lib/assistantHaptics');
    haptics.resetHapticsForTest(() => module);
    haptics.hapticSelect();
    haptics.hapticSuccess();
    haptics.hapticLight();
    expect(module.selectionAsync).toHaveBeenCalledTimes(1);
    expect(module.notificationAsync).toHaveBeenCalledWith('success');
    expect(module.impactAsync).toHaveBeenCalledWith('light');
  });

  it('is silent on the web', async () => {
    const module = stub();
    h.os = 'web';
    const haptics = await import('../src/lib/assistantHaptics');
    haptics.resetHapticsForTest(() => module);
    haptics.hapticSelect();
    expect(module.selectionAsync).not.toHaveBeenCalled();
  });

  it('is silent, and does not throw, when the native module is missing', async () => {
    const haptics = await import('../src/lib/assistantHaptics');
    haptics.resetHapticsForTest(() => {
      throw new Error('Cannot find native module ExpoHaptics');
    });
    expect(() => {
      haptics.hapticSelect();
      haptics.hapticSuccess();
      haptics.hapticLight();
    }).not.toThrow();
  });

  it('does not throw when the module is half-formed or a play rejects', async () => {
    const haptics = await import('../src/lib/assistantHaptics');
    haptics.resetHapticsForTest(() => ({ selectionAsync: () => Promise.reject(new Error('x')) }));
    expect(() => haptics.hapticSelect()).not.toThrow();
    const rejecting = { ...stub(), selectionAsync: () => Promise.reject(new Error('no engine')) };
    haptics.resetHapticsForTest(() => rejecting);
    expect(() => haptics.hapticSelect()).not.toThrow();
  });
});

/** WCAG relative luminance and contrast ratio of two #RRGGBB colours. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('MC-UI-05 contrast of the assistant pairs', () => {
  const themes: [string, Theme][] = [
    ['light', lightTheme],
    ['dark', darkTheme],
  ];

  for (const [name, theme] of themes) {
    const c = theme.color;
    // [foreground, background, what it is]
    const text: [string, string, string][] = [
      // Primary chips wear `text` on `brandSoft`: `brand` text on `brandSoft` is
      // 4.4:1 in light and 3.9:1 in dark, so the brand colour is for the border.
      [c.text, c.brandSoft, 'primary chip text (text on brandSoft)'],
      [c.text, c.surface, 'card text on surface'],
      [c.text, c.bg, 'secondary chip text on bg'],
      [c.textMuted, c.surface, 'micro links on surface'],
      [c.brand, c.surface, 'link text (See Pro) on surface'],
    ];
    for (const [fg, bg, what] of text) {
      it(`${name}: ${what} is at least 4.5:1`, () => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
    // Borders and glyphs are graphics, not text: 3:1 is the bar.
    const graphics: [string, string, string][] = [
      [c.brand, c.bg, 'primary chip border on bg'],
      [c.brand, c.brandSoft, 'sparkle glyph on brandSoft'],
      [c.onBrand, c.brand, 'send button glyph on brand'],
    ];
    for (const [fg, bg, what] of graphics) {
      it(`${name}: ${what} is at least 3:1`, () => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
