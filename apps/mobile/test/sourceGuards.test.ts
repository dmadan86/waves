/**
 * Source guards for bugs that only showed up on a device. Like the other guard
 * tests, these read the files: the components pull in React Native, which this
 * node suite cannot mount.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(ts|tsx|js|jsx|json)$/.test(entry.name) ? [path] : [];
  });
}

const ALL = files(SRC).map((path) => ({
  rel: relative(SRC, path),
  text: readFileSync(path, 'utf8'),
}));

/** The JSX tag a prop at `index` belongs to: the last `<Name` opened before it. */
function ownerTag(text: string, index: number): string {
  const before = text.slice(0, index);
  const matches = [...before.matchAll(/<([A-Za-z][\w.]*)(?=[\s>/])/g)];
  return matches[matches.length - 1]?.[1] ?? '';
}

const ANIMATED_SCROLLERS =
  /^(Animated\.(ScrollView|FlatList|SectionList)|AnimatedFlashList|AnimatedFlatList|AnimatedScrollView)$/;

describe('native-driver scroll events', () => {
  it('finds the scroll wiring this guard protects', () => {
    const count = ALL.filter((f) => /onScroll=\{Animated\.event\(/.test(f.text)).length;
    expect(count).toBeGreaterThan(0);
  });

  it('every onScroll={Animated.event(...)} sits on an Animated scroll component', () => {
    const bad: string[] = [];
    for (const { rel, text } of ALL) {
      for (const match of text.matchAll(/onScroll=\{\s*Animated\.event\(/g)) {
        const tag = ownerTag(text, match.index!);
        if (!ANIMATED_SCROLLERS.test(tag))
          bad.push(`${rel}: <${tag} onScroll={Animated.event(...)}>`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the onScroll ScenicScreen hands to a list render prop only goes to an Animated list', () => {
    const bad: string[] = [];
    for (const { rel, text } of ALL) {
      if (!/list=\{\(\{[^}]*\bonScroll\b/.test(text)) continue;
      for (const match of text.matchAll(/onScroll=\{onScroll\}/g)) {
        const tag = ownerTag(text, match.index!);
        if (!ANIMATED_SCROLLERS.test(tag)) bad.push(`${rel}: <${tag} onScroll={onScroll}>`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the detector would catch a plain ScrollView (self-check)', () => {
    const sample = '<View><ScrollView\n  style={s}\n  onScroll={Animated.event([], {})}\n/></View>';
    expect(ownerTag(sample, sample.indexOf('onScroll'))).toBe('ScrollView');
    expect(ANIMATED_SCROLLERS.test('ScrollView')).toBe(false);
    expect(ANIMATED_SCROLLERS.test('Animated.ScrollView')).toBe(true);
  });
});

describe('merge conflict markers', () => {
  it('no source file carries <<<<<<< or >>>>>>> at the start of a line', () => {
    const bad = ALL.filter(({ text }) => /^(<{7}|>{7})(\s|$)/m.test(text)).map((f) => f.rel);
    expect(bad).toEqual([]);
  });
});

describe('header icon buttons', () => {
  const header = readFileSync(join(SRC, 'components/home/TabHeader.tsx'), 'utf8');

  it('TabIconButton takes no ink prop: it is always on the surface, never white-on-white', () => {
    const start = header.indexOf('export function TabIconButton');
    expect(start).toBeGreaterThan(-1);
    const signature = header.slice(start, header.indexOf(') {', start));
    expect(signature).not.toMatch(/\bink\b/);
  });

  it('nobody passes ink to a TabIconButton', () => {
    const bad: string[] = [];
    for (const { rel, text } of ALL) {
      for (const match of text.matchAll(/<TabIconButton\b[^>]*?\bink=/gs))
        bad.push(`${rel}@${match.index}`);
    }
    expect(bad).toEqual([]);
  });

  it('draws its glyph in the theme ink, not a fixed white', () => {
    const start = header.indexOf('export function TabIconButton');
    const body = header.slice(start, start + 2500);
    expect(body).not.toMatch(/#fff(fff)?\b|['"]white['"]/i);
  });
});
