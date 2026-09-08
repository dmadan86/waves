import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

import { prepareOpenApiSpec } from './src/config/openapi';
import { markdownTokens, site } from './src/config/site';

/*
 * The help site at help.wavs.co.in — and at whatever host somebody self-hosting
 * Waves points it at instead. Nothing about the domain is written down here;
 * see src/config/site.ts.
 *
 * Docs-only: `routeBasePath: '/'` puts the help content at the root, because a
 * help site whose front door is a marketing page nobody asked for wastes the
 * first click. The marketing page is a separate deployment (website/).
 */

const config: Config = {
  title: 'Waves Help',
  tagline: 'How to split, settle and keep track of shared money',
  favicon: 'img/favicon.svg',

  url: site.url,
  baseUrl: site.baseUrl,

  // A wrong link is a support ticket, so it fails the build rather than ship.
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  onDuplicateRoutes: 'throw',

  trailingSlash: false,

  i18n: {
    // The same four the app and the marketing site speak. Arabic reads right to
    // left; on the web that is one `dir` attribute plus Infima's RTL sheet,
    // which Docusaurus swaps in on the strength of `direction` below.
    defaultLocale: 'en',
    locales: ['en', 'ta', 'hi', 'ar'],
    localeConfigs: {
      en: { label: 'English', direction: 'ltr', htmlLang: 'en' },
      ta: { label: 'தமிழ்', direction: 'ltr', htmlLang: 'ta' },
      hi: { label: 'हिन्दी', direction: 'ltr', htmlLang: 'hi' },
      ar: { label: 'العربية', direction: 'rtl', htmlLang: 'ar' },
    },
  },

  markdown: {
    /*
     * `.md` is CommonMark, `.mdx` is MDX.
     *
     * Docusaurus otherwise parses `.md` as MDX, which makes `{name}` a
     * JavaScript expression. The help pages quote the app's own strings, and
     * the app's strings are full of placeholders — "{name} paid {amount}",
     * "{n} days left as a guest" — so every one of them became a reference to
     * an undefined variable and failed the build. Escaping them all would mean
     * the source no longer matches what a translator has to compare against.
     * The generated API reference is `.mdx` and still gets the full parser.
     */
    format: 'detect',
    hooks: { onBrokenMarkdownLinks: 'throw' },
    /*
     * `{{apiBaseUrl}}` and friends become real addresses here. A React
     * component could do this in prose but not inside a fenced code block, and
     * the code blocks are exactly where the hostname has to be right.
     */
    preprocessor: ({ fileContent }) =>
      Object.entries(markdownTokens).reduce(
        (text, [token, value]) => text.split(token).join(value),
        fileContent,
      ),
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: `${site.repoUrl}/edit/main/apps/docs/`,
          // Translators edit the file under i18n/<locale>/, not the English one.
          editLocalizedFiles: true,
          showLastUpdateTime: true,
          breadcrumbs: true,
          docItemComponent: '@theme/ApiItem',
        },
        blog: false,
        pages: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          lastmod: 'date',
          changefreq: 'weekly',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    'docusaurus-plugin-sass',
    [
      'docusaurus-plugin-openapi-docs',
      {
        id: 'openapi',
        docsPluginId: 'classic',
        config: {
          waves: {
            specPath: prepareOpenApiSpec(),
            outputDir: 'docs/api/reference',
            // One category per tag, so the reference gains structure from the
            // spec rather than from a hand-kept list that drifts.
            sidebarOptions: { groupPathsBy: 'tag', categoryLinkSource: 'tag' },
            hideSendButton: true,
          },
        },
      },
    ],
  ],

  themes: ['docusaurus-theme-openapi-docs'],

  themeConfig: {
    colorMode: {
      defaultMode: 'light',
      // The ledger is a light-first design; the OS still gets the first word.
      respectPrefersColorScheme: true,
    },
    docs: {
      sidebar: { hideable: true, autoCollapseCategories: false },
    },
    navbar: {
      title: 'Waves Help',
      logo: {
        alt: 'Waves',
        src: 'img/logo.svg',
        // A navbar logo is an <img>, so it cannot inherit the theme's ink.
        srcDark: 'img/logo-dark.svg',
        width: 30,
        height: 21,
      },
      items: [
        { type: 'docSidebar', sidebarId: 'help', position: 'left', label: 'Help' },
        { type: 'docSidebar', sidebarId: 'api', position: 'left', label: 'API' },
        { type: 'localeDropdown', position: 'right' },
        { href: site.appUrl, label: 'Open Waves', position: 'right' },
        { href: site.siteUrl, label: 'wavs.co.in', position: 'right' },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Help',
          items: [
            { label: 'Getting started', to: '/getting-started/what-waves-is' },
            { label: 'Adding an expense', to: '/using-waves/add-an-expense' },
            { label: 'Settling up', to: '/using-waves/settle-up' },
            { label: 'Your data', to: '/privacy/export-your-data' },
          ],
        },
        {
          title: 'Developers',
          items: [
            { label: 'API overview', to: '/api/overview' },
            { label: 'Self-hosting', href: `${site.repoUrl}/blob/main/MIGRATION.md` },
            { label: 'Source', href: site.repoUrl },
          ],
        },
        {
          title: 'Waves',
          items: [
            { label: 'Home', href: site.siteUrl },
            { label: 'Open the app', href: site.appUrl },
            { label: 'Email us', href: `mailto:${site.supportEmail}` },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Waves`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.vsDark,
      additionalLanguages: ['bash', 'json', 'diff'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
