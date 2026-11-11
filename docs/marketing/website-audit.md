# Waves website marketing audit

Scope: marketing and discoverability of `website/` (pricing and CTA copy belong to the sales-conversion work). Checked against the local dev server, not the live site (it timed out).

## Ranked findings

| # | Impact | Finding | Status |
|---|--------|---------|--------|
| 1 | High | No use-case pages, so no entry for "split bills with roommates", "trip expense splitter", "split rent India" searches | Fixed: 3 pages at `/en/use-cases/*`, with FAQ, breadcrumb and app JSON-LD, in the sitemap and footer |
| 2 | High | App Store / Google Play listings do not exist yet (`NEXT_PUBLIC_IOS_URL` / `_ANDROID_URL` empty), so every CTA is "Coming soon" | Owner: set the two env vars. Badges and `installUrl` in JSON-LD switch on automatically. Badges are drawn lookalikes; vendors require their official artwork |
| 3 | High | `/personal` and `/companies` declared `openGraph` without an image, so they lose the file-convention share card; Twitter card had no image | Fixed |
| 4 | High | No social proof anywhere | Needs real data: reviews/ratings once live in the stores, real user quotes with consent, real user counts. Nothing was invented |
| 5 | Med | No social links in the footer, no `sameAs` on Organization | Fixed: `NEXT_PUBLIC_INSTAGRAM_URL` and `NEXT_PUBLIC_X_URL` (empty hides link). Owner: supply the handles |
| 6 | Med | No press/brand kit | Fixed: `/en/press` (logo SVG/PNG, colours, fonts, boilerplate, share card, screenshot) |
| 7 | Med | Organization had no logo; no WebSite node | Fixed (logo, WebSite, installUrl when set) |
| 8 | Med | Legal, support and MCP pages carry no per-page description or OG image (they inherit the home description) | Open, low effort: add `description` in each `generateMetadata` |
| 9 | Med | Compare, use-case and press pages are English-only (no ta/hi/ar), so no hreflang for them. Hindi/Tamil "split rent" queries are uncovered | Open: translate use-case pages if India-language SEO matters |
| 10 | Med | Referral programme is not mentioned on the site | Partly fixed: note on use-case pages. Correct current rule (verified in `packages/db/prisma/migrations/20261115090000_referral_credits`): 50 credits each when a new user's first expense is in a group of 2+; referrer paid for up to 10 friends. The brief's "7 days Plus, cap 30" is the older rule (migration 20261015140000), superseded. Memory notes should be updated |
| 11 | Med | No blog or changelog | Open: needs ongoing content, not a one-off. A changelog from release notes is the cheapest start |
| 12 | Med | No newsletter or waitlist; there is no backend for it | Not built, not faked. If wanted: a Resend audience (Resend is already a processor) plus a privacy-policy line |
| 13 | Low | Analytics/UTM: the site has no trackers or cookies. The app counts first-party steps and keeps the referral/campaign link (privacy policy). The site has no UTM capture or web-to-app attribution | Open: pass `utm_*` through store links once they exist. Add no third-party tracker without updating the "no tracking pixels" claim |
| 15 | Low | Trust section exists on home (PrivacyBand) but only as three pills | Partly fixed: "Privacy at a glance" block on use-case and press pages, taken from the privacy policy, including the honest "not end-to-end encrypted" line |
| 16 | Low | Accessibility: skip link, landmarks, `lang`/`dir` per locale and focus targets are present. No automated audit (axe/Lighthouse) was run | Open: run Lighthouse on the built site |

Already good: canonical and hreflang on localised pages, sitemap with alternates, robots, `llms.txt`, Markdown twin, FAQPage on home, MobileApplication JSON-LD, no fake `aggregateRating`.

## Needs the owner

- Instagram and X URLs (env vars above)
- App Store and Google Play URLs, then official badge artwork
- Real testimonials, ratings and any press mentions, with permission
- Decision on newsletter/waitlist and blog
- Confirm the founder/company wording for the press kit (it names no individual)
