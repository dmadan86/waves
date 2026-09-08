# Waves — help and API docs

The documentation site at **help.wavs.co.in**: end-user help for the app, and
the developer API reference generated from an OpenAPI document.

Docusaurus 3, pinned. Like `website/`, it is static, has no database, no auth
and no `@waves/*` imports, so it builds and deploys without touching the app.

```
docs/                        the English content
docs/api/reference/          generated from the OpenAPI document — not committed
openapi/                     the provisional OpenAPI document
i18n/<locale>/               translations, one directory per language
src/config/site.ts           every address the site prints, from env vars
src/config/openapi.ts        rewrites the spec's server URL before generating
src/css/custom.css           the ledger design tokens, mapped onto Infima
src/fonts/                   the two OFL faces this repo carries, with licences
```

## Running it

```bash
pnpm install
pnpm docs              # from the repo root
# or, in this directory
pnpm dev
```

`pnpm build` generates the API reference and then builds all four locales.
`pnpm serve` serves the result.

## The domain is configuration, not a constant

**`help.wavs.co.in` is a default.** Every address this site prints comes from an
environment variable read at build time, so somebody self-hosting Waves
(see [MIGRATION.md](../../MIGRATION.md)) can point the whole site — canonical
URLs, the links back to the product, and the API base URL in the curl examples —
at their own domain without editing a file.

| Variable              | Default                             | What it sets                                                               |
| --------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `DOCS_URL`            | `https://help.wavs.co.in`           | Where the docs live. Canonical URLs, sitemap, hreflang.                    |
| `DOCS_BASE_URL`       | `/`                                 | Sub-path, for serving under `/help` on an existing host.                   |
| `WAVES_SITE_URL`      | `https://wavs.co.in`                | The marketing site every "back to Waves" link returns to.                  |
| `WAVES_APP_URL`       | `https://app.wavs.co.in`            | The product. Where "Open Waves" goes.                                      |
| `WAVES_API_URL`       | `https://api.wavs.co.in`            | The API base URL, in prose, in curl examples, and in the spec's `servers`. |
| `WAVES_SUPPORT_EMAIL` | `hello@wavs.co.in`                  | "Email us", and the address on the delete-account page.                    |
| `DOCS_REPO_URL`       | `https://github.com/dmadan86/baaki` | "Edit this page", and the repository links.                                |
| `WAVES_OPENAPI_SPEC`  | `openapi/waves.provisional.yaml`    | The document the reference is generated from, relative to this directory.  |

There is deliberately no `.env.example` here: `website/` documents its variables
the same way, in its README, because a static site's variables are build
settings rather than secrets and there is nothing to keep out of git.

Two of those defaults are worth knowing before trusting them. **`DOCS_REPO_URL`
still names `dmadan86/baaki`**, which is the repository's old name — GitHub
redirects it, so every "Edit this page" link works and none of them says
`waves`; the constant is in `src/config/site.ts` and wants correcting there
rather than only here. And **`WAVES_OPENAPI_SPEC` points at the provisional
document**, not at `apps/api/openapi.yaml` — see below.

### Pointing it at a different domain

For a local check:

```bash
DOCS_URL=https://docs.example.org \
WAVES_API_URL=https://api.example.org \
WAVES_SITE_URL=https://example.org \
WAVES_APP_URL=https://app.example.org \
  pnpm build
```

For a real deployment, set the same variables in the hosting project's
environment (on Vercel: Project → Settings → Environment Variables) and
redeploy. Nothing in `docs/` names a host: the Markdown is written against
`{{apiBaseUrl}}`, `{{appUrl}}`, `{{siteUrl}}`, `{{docsUrl}}`, `{{supportEmail}}`
and `{{repoUrl}}`, which are substituted by `markdown.preprocessor` — inside
fenced code blocks as well as in prose, which is the reason it is a text
substitution and not a React component.

`DOCS_BASE_URL` covers the other shape of the question: serving the docs at
`example.org/help` rather than on their own subdomain. Set it to `/help/` and
every internal link, asset and font follows.

## The design

The tokens are the marketing site's, restated: a true-neutral ground, the violet
accent, hairlines rather than borders, small radii, and tabular figures wherever
a number appears. `src/css/custom.css` declares the whole palette on `:root` and
re-states only the same names under `[data-theme='dark']`, so neither theme can
end up rendering one theme's ink on the other's paper. Infima's own variables
are pointed at those names rather than being overridden one page at a time.

Three faces, all SIL OFL 1.1:

- **Overused Grotesk** — the text face. One variable file covering 300–900.
- **Departure Mono** — the pixel face, used for the wordmark only. Latin-only,
  so it is explicitly kept off the translated locales.
- **IBM Plex Mono** — code and figures, self-hosted through `@fontsource`.

The first two are committed in `src/fonts/` with their licence text beside them,
copied from `website/src/fonts` so this site deploys from its own directory
without reaching into a sibling app's source tree.

Noto Sans Arabic, Devanagari and Tamil come from `@fontsource` for the other
three languages. All of them are declared, but a browser only downloads the
faces a page actually uses, so a Tamil reader never fetches the Devanagari file.

## Languages

`en`, `ta`, `hi`, `ar` — the same four the app and the marketing site speak.
Arabic reads right to left, which Docusaurus applies from
`i18n.localeConfigs.ar.direction` (one `dir="rtl"` on `<html>` plus Infima's RTL
stylesheet).

**What is actually translated today:**

| Locale | Navigation, sidebar, footer | Docusaurus's own UI strings | The help pages |
| ------ | --------------------------- | --------------------------- | -------------- |
| `en`   | yes                         | yes                         | yes            |
| `ta`   | yes, unreviewed             | falls back to English       | English        |
| `hi`   | yes, unreviewed             | Docusaurus's bundled Hindi  | English        |
| `ar`   | yes, unreviewed             | Docusaurus's bundled Arabic | English        |

The prose has not been translated, and pretending otherwise by running a help
site through a machine would be worse than an honest English page. Docusaurus
falls back to the English file for any page a locale has not translated, so the
site works in every language today and gains each translated page the moment it
lands.

### Adding a translation

Copy the English file into the locale's docs directory, keeping the path:

```bash
mkdir -p i18n/ta/docusaurus-plugin-content-docs/current/using-waves
cp docs/using-waves/settle-up.md \
   i18n/ta/docusaurus-plugin-content-docs/current/using-waves/settle-up.md
# then translate the copy
```

Nothing else changes — no sidebar entry, no config. The file's `id` is what
binds it to the English original.

For the UI chrome, edit the JSON under `i18n/<locale>/`. To regenerate those
files after adding a navbar item or a sidebar category:

```bash
pnpm write-translations --locale ta
```

That merges new keys in and leaves existing translations alone. It also offers
to write a `code.json` of Docusaurus's own 82 UI strings; that file is
deliberately absent for `hi` and `ar` so Docusaurus's bundled translations for
those languages apply instead of being pinned to English.

## The API reference

The pages under `docs/api/reference/` are **generated** by
`docusaurus-plugin-openapi-docs` and are not committed — `pnpm build` regenerates
them every time, so the reference cannot outlive the document it describes.

Today it reads `openapi/waves.provisional.yaml`, a placeholder written so the
section had something to render while the real API was built in `apps/api`.

**`apps/api/openapi.yaml` now exists, and the swap is not yet the one-line
change this section used to describe.** Read the next four paragraphs before
setting the variable.

Whichever document it reads, its first `servers` URL is rewritten from
`WAVES_API_URL` into a build-only copy before generation
(`src/config/openapi.ts`), so a self-hosted help site documents its own host.
That rewrite is a line edit, not a YAML round-trip — parsing and re-emitting
would reformat somebody else's document for the sake of one string. It reads a
top-level `servers:` list whose first entry has a literal `url:` line, in any
key order, and touches only that entry.

The real document's first entry is a **templated** server: a literal `url:` line
carrying `'{protocol}://{host}'`, with a `variables:` block under it supplying
the defaults. That is the shape `apps/api` chose deliberately, for the same
reason this site takes its own addresses from the environment — no hostname is a
constant anywhere in that service. But it is also a literal `url:` line, so the
rewrite matches it, does **not** fail the build, and silently replaces the
template with one concrete host while leaving the now-meaningless `variables:`
block behind it.

So the paragraph that used to sit here — "a `{variable}` template fails the
build" — is wrong for this shape, and the failure it promised is exactly the
quiet outcome it was written to prevent. **This is a code question, not a
configuration one**, and it is open: either the rewrite should recognise a
templated server and leave it alone (letting the document describe its own
host), or it should rewrite the `variables:` defaults rather than the `url:`
line. Until that is settled, pointing `WAVES_OPENAPI_SPEC` at the real file
produces a reference whose server block contradicts itself.

**When it is settled**, the swap is:

1. Set `WAVES_OPENAPI_SPEC=../api/openapi.yaml` — in this directory's
   environment and in the Vercel project's.
2. Delete `openapi/waves.provisional.yaml`.
3. Remove the "provisional" warnings from `docs/api/overview.md`,
   `docs/api/authentication.md` and `docs/api/reference-intro.md`.

Meanwhile the site builds from the provisional document, which is a reference
that can drift from the API it describes — the one thing an OpenAPI document
exists to prevent. It is recorded here, and in `waves-tdr.md` §12 A70, rather
than left to be discovered by somebody comparing the two files.

## Deploying

Vercel, as its own project, with **Root Directory** set to `apps/docs`.

| Setting           | Value                 |
| ----------------- | --------------------- |
| Project name      | `waves-docs`          |
| Framework         | Docusaurus (detected) |
| Root directory    | `apps/docs`           |
| Install command   | `pnpm install`        |
| Build command     | `pnpm build`          |
| Output directory  | `build`               |
| Production domain | `help.wavs.co.in`     |

Nothing deploys on a push: `git.deploymentEnabled` is false in `vercel.json`, and
the only way a deployment happens is the **Vercel deploy (manual)** workflow in
the Actions tab — pick `docs` and a target. It needs `VERCEL_TOKEN`,
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID_DOCS` (the id in this directory's
`.vercel/project.json` after a `vercel link`) as repository secrets. Without
that last one the workflow stops on its first step; it used to fall through to
the web app's project id and would have published these docs over the product.

There are two `.vercelignore` files in play, and which one Vercel reads depends
on where the deployment's source root lands — this directory's when the root is
`apps/docs`, the repository's when the root is the repository. Both are written
to be safe for this site: the root one no longer excludes `apps/docs`, and its
`*.md` rule carries an exception for `apps/docs/**/*.md`, without which a help
site made of Markdown would deploy with no pages in it.

`vercel.json` carries an `ignoreCommand` so a push that did not touch this
directory does not spend a deployment — the free tier rate-limits on a burst of
commits.

The "Last updated" line under each page is read from git history. A host that
does a shallow clone will simply omit it rather than fail; if it is missing in
production and you want it, deepen the clone or drop `showLastUpdateTime` from
`docusaurus.config.ts`.

Like `website/`, this app is built **on Vercel** rather than uploaded prebuilt:
its dependencies are symlinks into a store at the repository root, so
`vercel build` run in this directory would package nothing above it. It has no
workspace dependencies, so installing from its own `package.json` resolves.

### DNS

`help.wavs.co.in` needs a `CNAME` to Vercel alongside the existing records for
the apex, `app` and `admin`. Add the domain to the Vercel project first; Vercel
then names the exact target.
