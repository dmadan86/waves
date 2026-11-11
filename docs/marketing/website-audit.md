# Waves website marketing audit

Scope: marketing and discoverability of `website/`. A Codex review verified this audit against the source (not the deployed site). Every item below uses three separate states, because "Fixed" used to conflate them:

- **Implemented in source**: the code is on the branch/main.
- **Configured in production**: env vars, listings and accounts exist on the deployed site. Unverified unless stated.
- **Verified live**: someone checked the deployed site. Nothing here is verified live yet.

## Status by item

| #   | Item                      | Implemented in source                                                                                                                                                                                                                          | Configured in production                                   | Verified live |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------- |
| 1   | Use-case pages            | 3 English pages at `/en/use-cases/*` with FAQ, breadcrumb and app JSON-LD, sitemap and footer links                                                                                                                                            | n/a                                                        | No            |
| 2   | Store CTAs                | Android defaults to the Play listing URL; iOS empty until `NEXT_PUBLIC_IOS_URL` is set. Badges are drawn lookalikes. A link existing does not prove the listing is published                                                                   | Unknown                                                    | No            |
| 3   | Personal/companies cards  | OG and Twitter images and descriptions set                                                                                                                                                                                                     | n/a                                                        | No            |
| 4   | Social proof              | None. Needs real evidence; nothing invented                                                                                                                                                                                                    | n/a                                                        | n/a           |
| 5   | Social links, `sameAs`    | Footer and Organization use `NEXT_PUBLIC_INSTAGRAM_URL` / `_X_URL`                                                                                                                                                                             | Unknown                                                    | No            |
| 6   | Press kit                 | `/en/press`: logos, colours, boilerplate, share card, screenshot                                                                                                                                                                               | n/a                                                        | No            |
| 7   | Structured data           | Shared `@id`s for Organization and app in `src/lib/structured-data.ts`; app node lists every configured install URL (Android and iOS); WebSite node on home                                                                                    | Install URLs depend on env vars                            | No            |
| 8   | Page metadata             | `pageMetadata()` in `src/lib/site.ts`; privacy, terms, refund, support, delete-account have unique descriptions and page-specific OG/Twitter title, description and URL. Descriptions are English in all locales (TODO: translate with bodies) | n/a                                                        | No            |
| 9   | English-only routes       | `src/lib/route-locales.ts` is the one list; `src/proxy.ts` sends bare `/press`, `/use-cases/*`, `/compare*`, `/alternatives*` to `/en/...` (exact boundary, query kept); sitemap uses it and omits alternates for these                        | n/a                                                        | No            |
| 10  | Referral programme        | Note on use-case pages. Migration `20261115090000_referral_credits` specifies 50 credits each, referrer capped at 10 friends                                                                                                                   | Migration deployment unconfirmed                           | No            |
| 11  | Sitemap `lastModified`    | Removed (it claimed every page changed on every build)                                                                                                                                                                                         | n/a                                                        | No            |
| 12  | UTM passthrough           | `src/lib/attribution.ts` + `AttributedLink`: only `utm_*` allowlist, 100-char cap, sessionStorage; appended to web-app links; Play link gets a URL-encoded `referrer`; wired into store badges, header, footer and compare/use-case CTAs       | App must consume the Play referrer / utm to count installs | No            |
| 13  | Click events              | `src/lib/marketing-events.ts` emits `store_click` / `web_app_click` (locale, path, placement, utm) via `sendBeacon`, only if `NEXT_PUBLIC_MARKETING_EVENTS_URL` is set. Privacy page mentions campaign tags in the browser session             | Endpoint not configured; no receiver exists                | No            |
| 14  | Video and nav a11y        | `lazy-video.tsx`: no autoplay, source attached near viewport, plays only when visible and motion allowed, labelled play/pause button in en/ta/hi/ar. `aria-current` only on real compare pages                                                 | n/a                                                        | No            |
| 15  | Trust content             | Privacy band on home; "Privacy at a glance" on use-case and press pages. Technical claims not independently audited                                                                                                                            | n/a                                                        | No            |
| 16  | Accessibility foundations | Skip link, landmarks, `lang`/`dir`, focus styles, reduced-motion CSS. No automated axe/Lighthouse run                                                                                                                                          | n/a                                                        | No            |

Clicks are not installs: a store click only becomes an install attribution once the app records the Play referrer.

Already good: canonical URLs on pages, sitemap, robots, `llms.txt`, Markdown twin, FAQPage on home, no fake `aggregateRating`. Hreflang is inconsistent across implementations (utility pages previously dropped HTML alternates; `pageMetadata` restores them), and several "localised" utility pages still have English bodies.

## Owner dependencies

| Owner input                                                                          | Unlocks                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Published store URLs and confirmation of platform availability                       | Accurate CTAs, official badges, install schema, press |
| Analytics destination, account access, retention choices, app/backend integration    | Campaign-to-signup/activation measurement             |
| Search Console access and production URL inspection                                  | Indexing, canonicals, sitemap and field performance   |
| Native-language review and priority markets                                          | Publishable Hindi/Tamil/Arabic acquisition content    |
| Confirmation the referral migration is deployed                                      | Safe publication of the 50-credit / 10-friend offer   |
| Newsletter purpose, sender/domain, provider credentials, backend ownership           | Working subscriptions and unsubscribe                 |
| Release/content owner                                                                | Maintained changelog and useful articles              |
| Real customer evidence with permission, verified social URLs, approved company facts | Trust content and completed press/social config       |

## Next steps (not started, owner decisions)

- Official store badge artwork in `public/stores/`; configure the iOS URL when published.
- Receiver for `NEXT_PUBLIC_MARKETING_EVENTS_URL` and a retention policy; app-side consumption of the Play referrer.
- Newsletter, blog and changelog: deliberately not built. A changelog from confirmed releases is the cheapest start.
- Translating the use-case, compare and press pages (Hindi/Tamil roommate and rent pages first): deliberately not done. When done, remove the family from `route-locales.ts` and add reciprocal alternates.
- Add axe/Lighthouse checks and measure Core Web Vitals on a production build.
