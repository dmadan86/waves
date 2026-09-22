/**
 * Every virtualized list has to be told that the theme changed.
 *
 * A FlashList row only re-renders when its item, its index, or `extraData`
 * changes. A light/dark switch is none of those — it is a context change, and
 * a recycled row that React never re-renders keeps the colours it was last
 * drawn in. The result on a real phone: switch from dark to light and the rows
 * already on screen stay in dark ink, which on a white card means names in
 * `#F4F3FF` on white — invisible until you scroll them off and back.
 *
 * It is not a thing anyone notices while writing a list, and it has now been
 * missed twice. So it is checked here instead: every `<FlashList>` in the app
 * must pass an `extraData` that depends on the theme, either directly or
 * through a memo declared in the same file.
 *
 * This is a source scan, deliberately. The alternative — mounting fifteen
 * screens and flipping the scheme — tests React's context propagation rather
 * than the thing that actually breaks, which is a prop nobody wrote.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

/** The props of one `<FlashList …>` element, from the tag to the end of its
    opening brace. Good enough: these are all formatted by Prettier, so the
    props of an element never share a line with the next element's. */
function listElements(source: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf('<FlashList', from);
    if (start === -1) return out;
    // `<FlashListRef` and prose mentions are not elements.
    const after = source[start + '<FlashList'.length];
    if (after !== '\n' && after !== ' ' && after !== '>') {
      from = start + 1;
      continue;
    }
    const end = source.indexOf('\n        >', start);
    out.push(source.slice(start, end === -1 ? source.length : end));
    from = start + 1;
  }
}

/** What `extraData={…}` is given, with the braces stripped. */
function extraDataOf(element: string): string | null {
  const at = element.indexOf('extraData={');
  if (at === -1) return null;
  let depth = 0;
  const from = at + 'extraData='.length;
  for (let i = from; i < element.length; i += 1) {
    if (element[i] === '{') depth += 1;
    else if (element[i] === '}') {
      depth -= 1;
      if (depth === 0) return element.slice(from + 1, i);
    }
  }
  return null;
}

const files = sourceFiles(SRC).filter(
  (file) => listElements(readFileSync(file, 'utf8')).length > 0,
);

describe('every FlashList re-renders its rows on a theme change', () => {
  it('finds the lists to check', () => {
    // A guard on the guard: if a refactor moves or renames the lists, this
    // suite must fail loudly rather than quietly checking nothing.
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files.map((file) => [file.slice(file.indexOf('src')), file]))(
    '%s',
    (_label, file: string) => {
      const source = readFileSync(file, 'utf8');
      for (const element of listElements(source)) {
        const extraData = extraDataOf(element);
        expect(extraData, `a <FlashList> in ${file} has no extraData`).not.toBeNull();

        // Either the expression names the theme itself, or it names a value
        // declared in this file whose definition does. A declaration is read as
        // the text that follows it, which is plenty to see a dependency in and
        // avoids parsing TypeScript to answer a one-word question.
        const expression = (extraData ?? '').trim();
        const declaration = /^[A-Za-z_$][\w$]*$/.test(expression)
          ? source.slice(
              source.indexOf(`const ${expression} =`),
              source.indexOf(`const ${expression} =`) + 400,
            )
          : '';
        const mentionsTheme = expression.includes('theme') || declaration.includes('theme');

        expect(
          mentionsTheme,
          `extraData for a <FlashList> in ${file} does not depend on the theme: ${extraData}`,
        ).toBe(true);
      }
    },
  );
});
