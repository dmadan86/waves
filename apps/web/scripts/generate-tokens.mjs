/**
 * Turning the design system into CSS.
 *
 * `packages/ui/src/themes.ts` is the only place a Waves colour is decided. The
 * phone reads it directly; the web cannot, because a stylesheet has no imports
 * — so this script reads the same module and writes `src/app/tokens.css`, a
 * file of custom properties that says exactly what the phone says.
 *
 * Why generate rather than hand-copy: the hand-copied version drifted. The web
 * spent months painting "owed to you" green while `tokens.ts` stated in so many
 * words that the palette is green-free and owed money is blue. A generated file
 * cannot hold an opinion of its own.
 *
 * The output is committed, so a build never depends on this running, and
 * `tokens.test.ts` regenerates it and fails if what is committed has gone
 * stale. Run it with `pnpm --filter @waves/web tokens`.
 *
 * Node 24 strips the types out of the `.ts` import on its own; there is no
 * build step between this script and the design system.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The design system is written the way TypeScript wants it — `import './tokens'`
// with no extension — which Node's resolver will not follow. Rather than bend
// the source to suit this script, teach the resolver the one rule it is
// missing: an extensionless relative specifier next to a `.ts` file means that
// `.ts` file. Nothing else in the process is affected.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
});

const here = dirname(fileURLToPath(import.meta.url));
const ui = (file) =>
  pathToFileURL(join(here, '..', '..', '..', 'packages', 'ui', 'src', file)).href;

const { darkTheme, lightTheme } = await import(ui('themes.ts'));
const { duration, iconSize, palette, radius, spacing, typography } = await import(ui('tokens.ts'));

const OUT = join(here, '..', 'src', 'app', 'tokens.css');

/** `surfaceMuted` → `surface-muted`, so a token reads like CSS rather than JS. */
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * A gradient is painted top-left to bottom-right on the web, where the phone
 * paints it along a vector it is given per component. 135deg is the angle the
 * dashboard's balance deck uses, and it is the only one the web needs.
 */
const wash = (stops) => `linear-gradient(135deg, ${stops.join(', ')})`;

/** `#1E1450` → `30 20 80`, so an alpha can be applied in `rgb(… / …)`. */
function channels(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/**
 * The phone's shadows are an offset, a blur and an opacity over a deep indigo.
 * Translated straight across; dark gets the same geometry over black at a
 * higher opacity, because an indigo shadow is invisible on a night surface and
 * a card there separates by shadow alone (its border is nearly its own colour).
 */
function shadows(scheme) {
  const ink = scheme === 'dark' ? '0 0 0' : channels('#1E1450');
  const lift = scheme === 'dark' ? 2.4 : 1;
  return [
    ['--w-shadow-soft', `0 8px 24px rgb(${ink} / ${(0.08 * lift).toFixed(3)})`],
    ['--w-shadow-lifted', `0 12px 28px rgb(${ink} / ${(0.16 * lift).toFixed(3)})`],
    // Not on the phone: the web has a hairline card at rest that the phone
    // draws with a border alone. One tight shadow keeps a white card off a
    // white-ish canvas without the 24px bloom the phone's `soft` carries.
    ['--w-shadow-hairline', `0 1px 2px rgb(${ink} / ${(0.06 * lift).toFixed(3)})`],
    ['--w-shadow-menu', `0 10px 30px rgb(${ink} / ${(0.18 * lift).toFixed(3)})`],
  ];
}

/**
 * The left rail, which the phone has no equivalent of — it wears a bottom tab
 * bar instead. Drawn from the night ramp in both themes rather than invented,
 * so the rail is the same object the dark theme is built from and the two
 * cannot drift apart. In dark the rail is one step *lighter* than the canvas,
 * because a black rail on a black page is not a rail.
 */
function rail(scheme) {
  const dark = scheme === 'dark';
  return [
    ['--w-rail', dark ? palette.night800 : palette.night900],
    ['--w-rail-raised', dark ? palette.night600 : palette.night700],
    ['--w-rail-ink', dark ? '#C6C6DA' : '#C3C8D4'],
    ['--w-rail-ink-faint', dark ? '#83839C' : '#7C8393'],
    ['--w-rail-line', `rgb(255 255 255 / ${dark ? 0.1 : 0.08})`],
  ];
}

/** Every property whose value depends on which theme is showing. */
function themed(theme) {
  const lines = [];

  for (const [name, value] of Object.entries(theme.color)) {
    lines.push([`--w-${kebab(name)}`, value]);
  }

  // A brand-filled button, which the phone does not have — its brand variant is
  // a tinted surface, not a solid. White on the dark theme's lighter brand
  // reads at about 3:1, under the contrast bar for a button label, so a solid
  // takes the deeper of the two brand tones there and the lighter one on hover.
  // Light keeps the ordinary pairing.
  lines.push([
    '--w-brand-solid',
    theme.scheme === 'dark' ? theme.color.brandPressed : theme.color.brand,
  ]);
  lines.push([
    '--w-brand-solid-hover',
    theme.scheme === 'dark' ? theme.color.brand : theme.color.brandPressed,
  ]);

  // The primary button's own edge. The design system gives it the same
  // near-black fill in both themes, which the phone compensates for by drawing
  // a border on it in dark — on a night surface a near-black button otherwise
  // disappears into the card it sits on. Same compensation, as a token.
  lines.push([
    '--w-button-primary-border',
    theme.scheme === 'dark' ? 'rgb(255 255 255 / 0.2)' : 'transparent',
  ]);

  // A second, stronger rule than `border`. The phone separates with space and
  // one hairline; a dense web table needs a heavier line under a header row.
  lines.push(['--w-border-strong', theme.scheme === 'dark' ? palette.night600 : palette.ink200]);

  for (const [name, stops] of Object.entries(theme.gradient)) {
    lines.push([`--w-gradient-${kebab(name)}`, wash(stops)]);
  }

  for (const [name, pair] of Object.entries(theme.tint)) {
    lines.push([`--w-tint-${name}`, pair.bg]);
    lines.push([`--w-tint-${name}-ink`, pair.ink]);
    lines.push([`--w-tint-${name}-ink-muted`, pair.inkMuted]);
  }

  lines.push(...rail(theme.scheme));
  lines.push(...shadows(theme.scheme));

  return lines;
}

/** Scales that mean the same thing under either theme. */
function scales() {
  const lines = [];

  for (const [name, value] of Object.entries(radius)) {
    lines.push([`--w-radius-${name}`, `${value}px`]);
  }
  for (const [name, value] of Object.entries(spacing)) {
    lines.push([`--w-space-${name}`, `${value}px`]);
  }
  for (const [name, value] of Object.entries(iconSize)) {
    lines.push([`--w-icon-${kebab(name)}`, `${value}px`]);
  }
  for (const [name, scale] of Object.entries(typography)) {
    lines.push([`--w-font-${name}`, `${scale.fontSize}px`]);
    lines.push([`--w-leading-${name}`, `${scale.lineHeight}px`]);
    lines.push([`--w-weight-${name}`, scale.fontWeight]);
  }
  for (const [name, value] of Object.entries(duration)) {
    lines.push([`--w-duration-${name}`, `${value}ms`]);
  }

  return lines;
}

const declare = (lines, indent) =>
  lines.map(([name, value]) => `${indent}${name}: ${value};`).join('\n');

const light = themed(lightTheme);
const dark = themed(darkTheme);

const css = `/*
 * GENERATED FILE — do not edit.
 *
 * Written by apps/web/scripts/generate-tokens.mjs from packages/ui/src/themes.ts
 * and tokens.ts, which is where a Waves colour, radius or type step is decided.
 * Change it there and run \`pnpm --filter @waves/web tokens\`.
 *
 * Three blocks, because a viewer has three states and not two: no preference
 * (the bare :root plus the media query), an explicit light choice (which must
 * beat a dark operating system, hence the :not()), and an explicit dark one.
 */

:root {
${declare(light, '  ')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${declare(dark, '    ')}
  }
}

:root[data-theme='dark'] {
${declare(dark, '  ')}
}

:root {
${declare(scales(), '  ')}
}
`;

writeFileSync(OUT, css, 'utf8');
process.stdout.write(`tokens.css — ${light.length} themed, ${scales().length} fixed\n`);
