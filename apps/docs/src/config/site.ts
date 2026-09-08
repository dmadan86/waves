/**
 * Where this site lives, and what it points at.
 *
 * `help.wavs.co.in` is the default, not a constant. Somebody self-hosting Waves
 * (MIGRATION.md) runs their own API on their own domain and their help site has
 * to say so — including in the curl examples, which are the one place a wrong
 * hostname costs a developer an afternoon. So every outward-facing address is
 * an environment variable with a working default, and the Markdown is written
 * against placeholders rather than literals.
 *
 * Read at build time only: the site is fully static, so there is no runtime to
 * read an env var in.
 */

/** Strip a trailing slash so `${url}/path` never produces a double slash. */
function origin(value: string, fallback: string): string {
  const raw = (value || '').trim() || fallback;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/** Docusaurus requires baseUrl to both start and end with a slash. */
function basePath(value: string | undefined): string {
  const raw = (value || '/').trim() || '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export const site = {
  name: 'Waves',

  /** Origin this documentation is served from. */
  url: origin(process.env.DOCS_URL ?? '', 'https://help.wavs.co.in'),

  /** Sub-path, for anyone serving the docs under `/help` on an existing host. */
  baseUrl: basePath(process.env.DOCS_BASE_URL),

  /** The marketing site every "back to Waves" link returns to. */
  siteUrl: origin(process.env.WAVES_SITE_URL ?? '', 'https://wavs.co.in'),

  /** The product itself. */
  appUrl: origin(process.env.WAVES_APP_URL ?? '', 'https://app.wavs.co.in'),

  /**
   * The developer API. Provisional: the API is being built alongside this site,
   * and nothing here should be treated as a promise until the real OpenAPI
   * document replaces `openapi/waves.provisional.yaml`.
   */
  apiUrl: origin(process.env.WAVES_API_URL ?? '', 'https://api.wavs.co.in'),

  supportEmail: (process.env.WAVES_SUPPORT_EMAIL || '').trim() || 'hello@wavs.co.in',

  /** Source of truth for the "Edit this page" links. */
  repoUrl: origin(process.env.DOCS_REPO_URL ?? '', 'https://github.com/dmadan86/baaki'),

  /**
   * The OpenAPI document the reference section is generated from. Points at the
   * provisional spec committed here until `apps/api/openapi.yaml` exists.
   */
  openApiSpec: (process.env.WAVES_OPENAPI_SPEC || '').trim() || 'openapi/waves.provisional.yaml',
} as const;

/**
 * Placeholders the Markdown is written against. Substituted by
 * `markdown.preprocessor`, so a value lands identically in prose, in a link and
 * inside a fenced code block — which a React component could not do.
 */
export const markdownTokens: Record<string, string> = {
  '{{apiBaseUrl}}': site.apiUrl,
  '{{appUrl}}': site.appUrl,
  '{{siteUrl}}': site.siteUrl,
  '{{docsUrl}}': site.url,
  '{{supportEmail}}': site.supportEmail,
  '{{repoUrl}}': site.repoUrl,
};
