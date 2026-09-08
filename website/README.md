# Waves — marketing site

The public site at **wavs.co.in**. A separate deployment from the product: this
one is static, has no database, no auth and no `@waves/*` imports, so it can be
rebuilt and redeployed without touching the app.

```
src/app/[locale]/          every page, one per language
src/app/[locale]/privacy   Privacy policy
src/app/[locale]/terms     Terms
src/app/[locale]/index.md  the same page as Markdown, per language
src/app/[locale]/[...rest] catch-all, so a miss gets our own 404 in-locale
src/app/llms.txt           an index for anything reading the site as text
src/components/            sections, drawn product visuals, primitives
src/fonts/                 the two self-hosted OFL faces + their licences
src/i18n/                  locale config + one dictionary per language
src/lib/currencies.ts      the ISO 4217 list the currency section is built from
src/lib/markdown.ts        renders a dictionary as the Markdown twin
proxy.ts                   bare paths get a locale prefix; Accept negotiation
```

## Running it

```bash
pnpm install
pnpm website          # from the repo root
# or, in this directory
pnpm dev
```

## Languages

`en`, `ta`, `hi`, `ar` — the same four the app speaks. Arabic reads right to
left, which on the web is one `dir="rtl"` on `<html>`; layout uses logical
properties (`ps`/`pe`, `ms`/`me`, `text-start`) so it mirrors on its own, and
the few directional icons flip through the `rtl:` variant defined in
`globals.css`.

The locale lives in the first path segment rather than a cookie, so a link
shared in Tamil opens in Tamil for whoever receives it, and every page
prerenders per language.

**English is the contract.** `Dictionary` is `typeof en`, so a key missing from
`ta.json`, `hi.json` or `ar.json` is a build error rather than a blank space on
a page nobody on the team can read. Add a key to `en.json` first, then to the
other three.

The legal pages are published in English in every locale on purpose — a
translated policy nobody has had reviewed would be worse than an honest English
one. They say so on the page.

## Design

The subject is a shared ledger, so the page is built from a ledger's materials:
a true-neutral ground rather than a tinted night sky, hairlines instead of glass,
radii small enough to read as ruled boxes, and every figure on the page set in a
monospace with tabular lining numerals.

**Light first, with a real dark theme.** Every surface and ink colour is a
`--w-*` custom property redefined in three places — bare `:root` (light),
`prefers-color-scheme: dark` guarded by `:not(.theme-light)`, and `.theme-dark` —
so the OS decides by default and the header's three-state toggle wins over it in
either direction. An inline script in the layout stamps the stored choice before
first paint. A component never names a colour literal; if it does, one of the two
themes is already broken.

Colour is spent in exactly two places: the violet accent the app already uses,
and the semantic money pair. Money never travels on colour alone — a sign and a
word go with it, so it survives colour blindness and greyscale. No green
anywhere.

Three typefaces, all SIL OFL 1.1, all self-hosted from `src/fonts` with the
licence text beside the file: **Overused Grotesk** for everything that is prose,
**IBM Plex Mono** for everything that is data, and **Departure Mono** for the
wordmark. The last two are Latin-only, so neither may ever be pinned to a string
that gets translated — `globals.css` hands Tamil, Devanagari and Arabic to their
own Noto faces, and only the script the page is actually written in is loaded.

The product illustrations are **drawn, not screenshotted** — a screenshot cannot
be translated, goes stale the week the UI moves, and ships a 400 KB PNG. Because
they are live DOM, each one carries `role="img"` and a translated `aria-label`
so a screen reader hears one summary instead of a hundred loose fragments.

## Being read by machines

Every page has a Markdown twin at `/{locale}/index.md`, generated from the same
dictionary the page renders from, so it cannot drift. It is advertised three
ways: a `<link rel="alternate" type="text/markdown">` in the head for DOM
crawlers, an HTTP `Link:` header for headless ones, and `Accept: text/markdown`
content negotiation in `proxy.ts` — which decides on the header's q-values only,
never on the user agent, because that would be cloaking. Responses carry
`Vary: Accept`.

`/llms.txt` indexes the whole thing. Expect no search-engine effect from any of
it; what it buys is a clean answer when somebody pastes the domain into an
assistant.

## Deploying

Vercel, as its own project, with **Root Directory** set to `website`.

| Setting           | Value                          |
| ----------------- | ------------------------------ |
| Project name      | `waves`                        |
| Framework         | Next.js (detected)             |
| Root directory    | `website`                      |
| Install command   | `pnpm install`                 |
| Build command     | `pnpm build`                   |
| Production domain | `wavs.co.in`, `www.wavs.co.in` |

Nothing deploys on a push: `git.deploymentEnabled` is false, and the only way a
deployment happens is the **Vercel deploy (manual)** workflow in the Actions tab
— pick `website` and a target. It needs `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID_WEBSITE` (the id in this directory's `.vercel/project.json`
after a `vercel link`) as repository secrets.

`vercel.json` carries an `ignoreCommand` so a push that did not touch this
directory does not spend a deployment — the free tier rate-limits on a burst of
commits.

### Environment variables

| Name                   | Default                  | What it is                  |
| ---------------------- | ------------------------ | --------------------------- |
| `NEXT_PUBLIC_SITE_URL` | `https://wavs.co.in`     | Canonical URLs, sitemap, OG |
| `NEXT_PUBLIC_APP_URL`  | `https://app.wavs.co.in` | Where every CTA points      |

Both have working defaults; set them only if a domain moves.

The apex question is settled: this site owns `wavs.co.in`, the product answers
on `app.wavs.co.in` and the console on `admin.wavs.co.in`. The mobile app's
invite links and the button in every email resolve against `app.wavs.co.in`,
so nothing here should be pointed back at the apex.
