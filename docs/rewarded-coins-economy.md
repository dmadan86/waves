# Coins for attention — rewarded ads funding the expensive features

**Status:** analysis and development plan. Nothing here is built. No code, no migration, no
dependency has been added.
**Written:** 2026-09-08.
**Proposed feature id:** A65 (TDR §12 amendment), plus addenda to ADR-005, ADR-006, ADR-011 and
ADR-013.
**Asked for:** free users watch rewarded video ads to earn coins; coins buy advanced voice entry,
camera receipt recognition, and bank-statement import; blockers must not be rewarded; paying
removes ads; global, not India-only.

**How to read the numbers.** Every figure carries a label and they are not interchangeable:

| Label         | Meaning                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| **list**      | read off the vendor's own pricing page on 2026-09-08                               |
| **quoted**    | verbatim from a primary policy/regulatory source                                   |
| **secondary** | a real published number, but from a vendor blog, aggregator or analyst — unaudited |
| **derived**   | arithmetic on a list price, with the assumption stated                             |
| **estimate**  | inference with no publisher behind it, always given as a range                     |

Nothing in this document is upgraded from `secondary` to `list` for readability. Where a source
could not be established at all, §10 says so rather than filling the gap.

---

## 1. Recommendation

### 1.1 The short answer

**Build the ads. Do not build the coin economy — not yet, and probably not in the shape asked
for.** Three findings, in order of how much they change the plan:

**(a) Two of the three features you want to sell for coins are too cheap to be worth rationing.**
A cloud voice expense — speech-to-text plus LLM structuring — costs **$0.00015–$0.00017**
(_derived_ from AssemblyAI Universal-2 at $0.15/hr and GPT-5 nano at $0.05/$0.40 per M tokens,
both *list*). A cloud receipt read by a vision model costs **~$0.00022** on Gemini 2.5 Flash-Lite
(_derived_). One completed rewarded impression in India — this app's largest market and its
lowest-eCPM one — nets on the order of **$0.0007–$0.001** (_derived_ from a _secondary_ eCPM,
after a vertical discount and fill; §7). **One ad funds four to seven voice expenses in India and
fifty to eighty in the United States.** A currency that meters something costing four cents per
thousand uses is not cost recovery; it is friction wearing the costume of economics, and users
read that as artificial scarcity. Give cloud voice away, or put it behind a generous monthly
allowance — the meter for which is **already built and shipped dark** (`voice_stt_usage`,
`app_config.voice_stt_free_seconds = 300`, `waves_my_voice_access`).

**(b) One feature is genuinely expensive, and its price spans four orders of magnitude.** A
20-page bank statement costs **$0.0057** on Gemini 2.5 Flash-Lite (*derived*), **$0.077** on
Claude Haiku 4.5 (_derived_), **$0.30** through AWS Textract table extraction (*list*), and
**$10–$40** through Ocrolus or Inscribe (_estimate_, no vendor-published price exists). Multiply
the LLM figures by **2–3×** for the chunked per-page extraction and balance-continuity
reconciliation the feature actually needs. At the specialist end **a single free-tier statement
import costs more than an Indian subscriber pays for a year** (§7.5). Statement import is the only
feature with a real cost basis for per-use pricing — and it is also, by a distance, the highest
legal and privacy risk in the request (§8).

**(c) Ad revenue is not a business model at this app's scale and geography; it is a demo budget.**
At 0.1–0.5 rewarded impressions per DAU (_estimate_) and a tier-3 net of ~$0.0008 per completed
view, ads yield roughly **$0.03–$0.15 per DAU per year** in India (*derived*). A subscription at
the ADR-011 India tier (₹49–99/mo) nets roughly **$9–$12 per subscriber per year**. Ads are about
**1%** of a subscription's value there, and about **2%** in the United States. Budget the whole
thing as customer acquisition — a way to let a free user _feel_ the AI features before deciding —
and the numbers stop being alarming. Budget it as revenue and it will disappoint.

### 1.2 What to build instead, in order

1. **Ship the purchase first.** This is the blocking item and it is not about ads at all.
   `subscriptions` exists, `waves_profile_is_paid` works, `waves_group_is_paid` gates the group
   photo and the receipt cap — but **nothing in the app can buy a subscription today.**
   `apps/mobile/src/app/settings/upgrade.tsx` says so in its own header comment ("There is no paid
   tier to sell today — no store products, no prices, no receipts"), and
   `apps/mobile/src/app/paywall.tsx` is placeholder UI with hardcoded English copy, placeholder
   prices and no store wiring; its header flags the contradiction as a deliberate follow-up.
   **Shipping ads before shipping the purchase means free users have no escape from them**, which
   is both a bad product and — per Apple 3.1.1 (_quoted_: subscribers "should allow a user to get
   what they've paid for without performing additional tasks") — the wrong order to build in.
2. **Ship the ad, one ad at a time, with no currency.** One opt-in rewarded view unlocks one
   named action. Spotify's 2014 Sponsored Sessions is the pattern — watch a ≤30s video, get 30
   minutes ad-free ([TechCrunch, 2014-09-08](https://techcrunch.com/2014/09/08/the-music-streaming-revolution-will-be-televised/)) —
   and it has no balance, no wallet, no expiry, no farm value, no ledger and almost no
   consumer-law surface. It is the lowest-risk shape available and it satisfies the actual
   request: attention buys the expensive thing.
3. **Add coins only when there are ≥3 spendable things of genuinely different cost.** Today there
   are not: voice is free-shaped, cloud OCR is free-shaped, and statement import is either
   ad-fundable-in-tier-1-only or a paid feature. A currency earns its complexity when a user must
   _choose between_ things of different price. Reddit retired a currency with 50+ instruments and
   said the reason was surface-area complexity, not fraud
   ([TechCrunch, 2023-07-14](https://techcrunch.com/2023/07/14/reddit-is-killing-its-gold-awards-system/)).
4. **Ship statement import as a paid feature, not an earned one — and gate it behind compliance,
   not engineering.** §8.

### 1.3 What would make me say no outright

- **If the answer to "can a paying user ever see an ad?" is anything but a hard no**, stop. There
  is no purchase path today, so the entitlement read has never been exercised on a cold start, and
  a finance app that shows an advert to somebody who paid to remove them earns a refund and a
  one-star review that outlives the impression by years.
- **If the rewarded path cannot be made to build on this Expo SDK.** Full-screen (rewarded) ads
  and UMP are the _least_ complete parts of `react-native-google-mobile-ads` on the New
  Architecture ([invertase README](https://github.com/invertase/react-native-google-mobile-ads)),
  Expo SDK 55+ requires New Architecture
  ([Expo SDK 54 changelog](https://expo.dev/changelog/sdk-54)), and this repo is on Expo `~57.0.18`
  / RN `0.86.3`. Issue [#835](https://github.com/invertase/react-native-google-mobile-ads/issues/835)
  (opened 2026-02-09, closed as not planned, no fix version) reports the config plugin failing to
  load on SDK 54. **This is the first task in the plan, not a late integration step**, and the
  repo builds locally via `gradlew` so the loop is fast.
- **If statement import must use a specialist vendor.** Ocrolus and Inscribe are annual enterprise
  contracts with no self-serve tier; Docsumo, Klippa and Plaid Statements publish no price at all.
  At $10–40 per statement, no plausible number of rewarded ads funds one, and pretending otherwise
  is how you lose money per user.
- **If sending statements to an LLM requires a zero-data-retention agreement you cannot sign.**
  Azure's ZDR ("modified abuse monitoring") **requires an Enterprise Agreement or Microsoft
  Customer Agreement and is explicitly unavailable on pay-as-you-go**; Anthropic's, OpenAI's and
  Google Vertex's are all sales-gated. **AWS Bedrock is zero-retention by default** (with named
  model exceptions) and is the only self-serve path found. If none of those is reachable, statement
  parsing stays on-device or does not ship.

### 1.4 One thing the request gets wrong, said plainly

You asked to detect ad blockers and DNS blockers and withhold points from those users. **Don't
detect anything.** Mint coins _only_ on Google's signed **Server-Side Verification callback** — a
request Google's servers make to yours when a reward is genuinely earned. If the ad never served,
no callback arrives, and no coins exist to withhold. That defeats every blocker structurally,
without a detector to maintain. Client-side blocker sniffing is trivially defeated, breaks on every
SDK update, and produces false positives against Pi-hole, NextDNS, AdGuard, corporate and school
resolvers, private-DNS settings and VPNs — punishing people whose only crime is a privacy setting.
If you want blocker or VPN signals at all, feed them into a risk _score_ that changes review
priority, never into the gate. §6 designs the SSV path in full.

---

## 2. Competitive benchmark

### 2.1 The category, and the ground Splitwise vacated

[Splitwise's own Pro page](https://www.splitwise.com/pro) sells, among other things, **"a totally
ad-free experience"**, **"unlimited expenses"**, **"no interruptions"**, and **receipt scanning
with item-level detection** (_quoted_, retrieved 2026-09-08). Three things follow directly:

1. **The free tier already shows ads** — otherwise removing them would not be a selling point.
   Ads in a bill-splitting app are established category behaviour, not a novel imposition, and an
   _opt-in, user-initiated_ rewarded video is strictly gentler than whatever "no interruptions"
   is buying relief from.
2. **Receipt OCR is already a paid-tier feature at the category leader.** Waves offering it for
   an ad is more generous than the incumbent, not less.
3. **Splitwise gated the core job.** Its Pro page sells "unlimited expenses"; the App Store
   listing carries a user review reading _"There is absolutely no reason why a free account should
   be limited on the number of expenses it can enter per day."_ The exact cap is **not published by
   Splitwise anywhere** — roughly a dozen blogs quoting "3/day" or "5/day" are rival
   bill-splitting products with a commercial interest in the number and they contradict each
   other. Do not cite them; the cap is real, its value is undocumented.

**That last point is the strategic finding.** Splitwise made the free tier hostile _at the thing
the app is for_, and grew a permanent cottage industry of "Splitwise alternative" and "Splitwise
daily limit" SEO against itself. Waves' ADR-011 rule (1) already forbids that mistake. A rewarded
ad funding the _expensive extras_ is the kind answer to the same conversion problem, and it takes
exactly the ground Splitwise left open.

Pricing is not publicly documented. The [US App Store listing](https://apps.apple.com/us/app/splitwise/id458023433)
(id458023433, retrieved 2026-09-08) exposes ten IAP SKUs — `$2.99 ×3 · $3.99 · $4.99 ×3 · $29.99 ·
$39.99 · $59.99` — consistent with regional pricing and/or live price testing plus a multi-seat
tier. **Estimate:** US individual Pro ≈ **$4.99/mo or $39.99/yr**. Anyone quoting one number is
guessing.

| App       | Model                                                                                                | Ads?                       |
| --------- | ---------------------------------------------------------------------------------------------------- | -------------------------- |
| Splitwise | Free + Pro; free tier capped at a few expenses/day                                                   | **Yes** (Pro removes them) |
| Settle Up | Free with ads; premium exists mainly to remove them                                                  | **Yes**                    |
| Tricount  | Free, no IAP since the bunq acquisition; premium discontinued; monetises by funnelling to bunq cards | No                         |
| Splid     | Free, no signup; one-time $3.99 unlock                                                               | No                         |

Source: [lovemoney round-up](https://www.lovemoney.com/news/85624/best-free-bill-splitting-apps-tricount-splid-settle-up-acasa-splitwise) (_secondary_).
**No split-expense app runs a coin economy.** Shipping one is first-in-category — which is both
the opportunity and the reason a store reviewer will look at it with fresh, unprimed eyes.

### 2.2 Duolingo — the two lessons, one of them a warning

Duolingo replaced hearts with **Energy** through an A/B test in April–May 2025, announced more
broadly in July 2025: 25 units, **every question costs one unit whether or not you get it right**,
refilled by correct-answer streaks, ads (varies by test group), practice, natural recharge, or 750
gems for a full refill; Super/Max subscribers get unlimited ([duoplanet, 2025-10-02](https://duoplanet.com/duolingo-energy-system/)).

The reception was severe: a ~3,000-upvote Reddit thread titled _"So now we're punished for using
the app?"_, users with 750-day streaks publicly leaving, and coverage from
[Android Authority](https://www.androidauthority.com/quitting-duolingo-energy-system-3599842/) and
[Class Central](https://www.classcentral.com/report/duolingo-breaks-hearts-for-energy/). The shift
that caused it was from _punishing mistakes_ to _capping total daily activity at the core task_.

**Lesson one: a currency that meters effort at the core job produces revolt, even at the company
with the best gamification team in consumer software.** A currency that meters an expensive
optional superpower does not. Waves' AI features are the second kind — keep them there. Splitting,
adding an expense and settling must never cost a coin, which is ADR-011 rule (1) restated.

**Lesson two, structural and less obvious: the subscription is sold partly as an escape from the
ad loop.** Super removes ads, and therefore removes the "watch an ad for a refill" option
entirely. The friction _is_ the ad, and the paid tier's proposition is friction removal. If free
coins are so generous nobody feels a ceiling, the paid tier has no job; if the ceiling is punitive,
you get the Energy backlash. Tuning that gap is the design problem, and it is why §5 sets the cap
as an `app_config` knob with A/B arms rather than a constant.

Duolingo's per-ad gem grant is **not officially documented anywhere** and there is **no public
engineering write-up of how they tune earn rates** — I looked specifically; the most-cited
first-person account, [former CPO Jorge Mazal in Lenny's Newsletter (2023-02-28)](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth),
does not mention hearts, gems, ads or earn rates at all. Pricing figures below are _estimate_, from
aggregators, not Duolingo:

| Tier                                    | Monthly | Annual        |
| --------------------------------------- | ------- | ------------- |
| Super (ad-free, unlimited energy)       | ~$12.99 | ~$83.99–95.99 |
| **Max** (adds AI video call / roleplay) | ~$29.99 | ~$168         |

Sources: [languageappguide](https://languageappguide.com/pricing/duolingo-cost/),
[dealnews, Sept 2026](https://www.dealnews.com/features/duolingo/cost/).
**The pattern worth copying: the AI tier is ~2.3× the ad-removal tier, because AI carries real
marginal cost and ad-removal is a margin giveaway.** They should not be one price.

### 2.3 The direct-unlock precedents

- **Spotify Sponsored Sessions** (launched September 2014): watch a ≤30s video, get 30 minutes of
  uninterrupted listening; delivered at the _start_ of a session, only with the app in view, via a
  prompt offering to "take a break from the ads"
  ([TechCrunch](https://techcrunch.com/2014/09/08/the-music-streaming-revolution-will-be-televised/),
  [9to5Mac](https://9to5mac.com/2014/09/08/spotify-app-to-offer-30-mins-of-ad-free-listening-if-you-watch-a-15-30-second-video-ad-first/)).
  **Could not confirm it is still live in 2026** — the `ads.spotify.com` URL that search surfaced
  now serves Sponsored Playlist content. Treat as a well-documented historical pattern.
  **This is the shape §1.2 recommends.**
- **Google Opinion Rewards** — the expiry precedent, and the only one with an official primary
  source: _"Each credit expires one (1) year from the date it was earned"_, with the expiration
  date shown **on the home screen under the total balance**
  ([Google Opinion Rewards Help](https://support.google.com/opinionrewards/answer/6322284?hl=en), _quoted_).
  Reward is platform-locked store credit, never cash. Copy this: visible per-lot expiry, never a
  silent sweep.
- **Microsoft Rewards** — the cash-adjacent extreme, and what a mature anti-farm design looks like:
  layered caps _per level, per day, per month, per region, per household, per offer_, with
  permanent bans and point invalidation for bots, emulators, IP-alteration services, multiple
  accounts and cross-country earn/redeem
  ([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5865682/i-got-banned-from-my-microsoft-rewards-account-for)).
  It needs all six layers **because its currency converts to real-world value**. Waves' must not,
  which is why Waves does not need all six.
- **Blinkist / Headway** — I searched specifically for a "watch an ad to unlock a chapter"
  mechanic at either and **could not verify it exists**. What is confirmed is a **daily free
  allowance** (Blinkist's "Daily Pick", Headway's "Free Daily Read"). Worth keeping anyway: a
  daily free item is a currency-free way to guarantee nobody is ever fully dead-ended, and it
  composes on top of anything else.

### 2.4 TikTok Lite under the DSA — read the objection carefully

This is the case any rewards-for-attention design has to answer, and the detail that matters is
_what was actually charged_.

**What it was.** TikTok Lite launched in France and Spain in April 2024 with a "Task and Reward
Program" for 18+ users. Verbatim from the Commission: users _"earn points while performing certain
'tasks' on TikTok, such as watching videos, liking content, following creators, inviting friends to
join TikTok, etc."_ and _"These points can be exchanged for rewards, such as Amazon vouchers, gift
cards via PayPal or TikTok's coins currency."_

**Timeline** (all dates from the Commission's own text):

| Date       | Event                                                                                                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2023-04-25 | TikTok designated a Very Large Online Platform under the DSA                                                                                                                                                                             |
| 2024-02-19 | First formal DSA proceedings opened (minors, ad transparency, addictive design) — still open                                                                                                                                             |
| 2024-04-17 | Commission demands the risk-assessment report by 18 April                                                                                                                                                                                |
| 2024-04-18 | TikTok fails to provide it                                                                                                                                                                                                               |
| 2024-04-22 | **Second formal proceedings opened**; binding RFI decision; Commission announces intent to impose **interim measures suspending the programme EU-wide** ([IP/24/2227](https://ec.europa.eu/commission/presscorner/detail/en/ip_24_2227)) |
| 2024-04-24 | Commission "took note of TikTok's decision to voluntarily suspend"                                                                                                                                                                       |
| 2024-08-05 | Commitments made **legally binding**; proceedings closed after 105 days ([IP/24/4161](https://digital-strategy.ec.europa.eu/en/news/tiktok-commits-permanently-withdraw-tiktok-lite-rewards-programme-eu-comply-digital-services-act))   |

**The charged breach.** Under the DSA, VLOPs must _"submit a risk assessment report, including
measures to mitigate any potential systemic risks, prior to launching any new functionalities that
are likely to have a critical impact on their systemic risks."_ The Commission's concern was that
the programme launched _"without prior diligent assessment of the risks it entails, in particular
those related to the addictive effect of the platforms"_ and that this was _"of particular concern
for children, given the suspected absence of effective age verification mechanisms."_ Named basis:
_"these failures would constitute infringements of Articles 34 and 35 of the DSA."_ (All _quoted_
from IP/24/2227.)

**Outcome:** TikTok committed to withdraw the programme from the EU permanently and not to launch
any circumventing programme. **No fine was imposed** — but any breach of the commitments would
itself be a DSA breach.

**Four factors stacked, and Waves differs on three:**

| Factor                                                             | TikTok Lite             | Waves as proposed                                                                                                 |
| ------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Reward was for **engagement itself** (watch, like, follow, invite) | Yes                     | **No** — a coin buys the user's own AI feature, not screen time                                                   |
| Points converted to **cash equivalents** (Amazon, PayPal)          | Yes                     | **No** — non-transferable, in-app only, and AdMob forbids the alternative anyway                                  |
| **Minors exposed** with no effective age verification              | Yes                     | **Must be designed out** (§4.5)                                                                                   |
| **No prior risk assessment** filed                                 | Yes — the actual charge | **Not binding** (Waves is nowhere near VLOP scale; Arts. 34/35 attach to designated VLOPs) — **write one anyway** |

That last row is the cheapest insurance in this document. A two-page pre-launch note — who can
earn, what the caps are, why this is not engagement-farming, the minors position, the abuse
controls, the consent stack — costs a morning and is precisely the artifact that ends an inquiry
before it starts. With the Digital Fairness Act due Q3/Q4 2026 (§2.5), it will age well.

**The design lines this draws, and they are not negotiable if you want to stay on the safe side:**
no daily check-in, no streak multiplier, no reward for passive consumption, no reward for social
recruitment, a hard daily cap, and a reward tied to a concrete feature unlock rather than an
open-ended points balance.

### 2.5 The two regulatory instruments that will actually govern a coin economy

**CPC Network Key Principles on In-Game Virtual Currencies, 21 March 2025** — the most directly
applicable guidance in this whole review, and less well known than the TikTok case. Published by
national consumer authorities coordinated by the Commission (led by the Dutch ACM and Norwegian
Consumer Authority) alongside enforcement against Star Stable Entertainment AB
([IP/25/831](https://ec.europa.eu/commission/presscorner/detail/en/ip_25_831)). The principles set
_"the minimum requirements for the purchase and use of virtual currencies, including: clear and
transparent pricing and pre-contractual information; avoiding practices hiding the costs of in-game
digital content and services…; respect of consumers' right of withdrawal; respecting consumer
vulnerabilities, in particular when it comes to children"_ (_quoted_). The Star Stable practices
found unlawful included _"purchase through time-limited practices"_ and _"a lack of clear and
transparent information… leading consumers to spend more than they intend to"_.

**Why this bites even though Waves' coins would be earned, not bought:** _"hiding the costs of
digital content"_ is about obscuring real prices behind a currency layer. Showing "40 coins"
without ever saying what 40 coins costs — in ads, or in money — is the exact opacity targeted.
**Show the real-money equivalent next to every coin price, from day one.** It is cheap now and
expensive to retrofit into every price surface later.

**Digital Fairness Act.** Commission legislative proposal expected **Q3/Q4 2026** — within months
of writing. Single instrument covering dark patterns, addictive design, loot boxes, **in-app
virtual currencies**, influencer marketing and unfair personalised pricing. Consultation signal:
~70% of respondents want binding rules on in-game spending, emphasising **display of in-app prices
in real-world money**. **Unlike the DSA, it applies to traders generally, so it will bind Waves.**
(_secondary_ — the proposal text does not exist yet:
[digitalfairnessact.com](https://digitalfairnessact.com/what-is-the-digital-fairness-act),
[Freshfields](https://www.freshfields.com/en/our-thinking/blogs/technology-quotient/the-eus-proposed-digital-fairness-act-a-game-developers-guide-to-potential-imp-102ltio).)

**Does the DSA itself bind Waves? Probably not — and the plan should say so rather than
over-comply.** DSA Art. 3(i) defines an online platform as a hosting service that stores _and
disseminates information to the public_; where access requires admittance to a group, information
is public only if members are admitted automatically without a human decision. A Waves group is a
closed set admitted by invitation. **Arts. 25 and 28 most likely do not attach.** But the
_substance_ of Art. 25 — no interface that "materially distorts or impairs the ability of
recipients to make free and informed decisions" — is what consumer authorities read into the UCPD,
which applies to every trader regardless. You do not get to ignore it. (_secondary_:
[EDAA](https://edaa.eu/digital-services-act/am-i-a-platform-under-the-dsa/).)

### 2.6 Other cautionary cases, briefly

- **FTC v. Epic Games, 2022-12-19 — $520M total** ($275M COPPA penalty, $245M refunds) for dark
  patterns: _"counterintuitive, inconsistent, and confusing button configuration led players of
  all ages to incur unwanted charges based on the press of a single button"_
  ([FTC](https://www.ftc.gov/business-guidance/blog/2022/12/245-million-ftc-settlement-alleges-fortnite-owner-epic-games-used-digital-dark-patterns-charge)).
- **FTC v. Cognosphere (Genshin Impact), January 2025 — $20M** over deceptive loot-box marketing
  and children's privacy.
- **Loot boxes:** Belgium, Finland and the Netherlands have treated real-money loot boxes as
  gambling (Belgium: criminal fines to €800,000). **But the Netherlands' €10M fine against EA was
  overturned** when a court held a mechanic integrated into gameplay was not a standalone gambling
  product — the encouraging precedent that an integrated, non-randomised _utility_ currency is a
  different legal object (_secondary_: [Promise Legal](https://blog.promise.legal/loot-box-laws-game-developers/)).
- **I could not find a clean case of a rewarded-ad coin economy killed specifically by farming.**
  Reddit's currency died of complexity; Microsoft's is farmed continuously and survives as an
  operating cost; the play-to-earn collapses (Farmers World: daily active wallets 140,000 → 73,000)
  are a different economic species. Do not tell the story that a coin economy gets farmed to death;
  tell the story that it gets _taxed_ by farming forever.
- **Scale of the underlying fraud economy** (_secondary_, vendor research via
  [Business of Apps](https://www.businessofapps.com/ads/ad-fraud/research/ad-fraud-statistics/) and
  [24Metrics](https://www.24metrics.com/learn/mobile-fraud-trends-2025/)): global mobile ad fraud
  losses $17.2B (Juniper, 2025), ~33% of mobile app traffic invalid in Q3 2025, and — the number
  that matters here — **"incentive abuse" is a named, measured category at ~19% of gaming ad
  fraud.** A rewarded economy opts into that category deliberately. Budget for it.

---

## 3. What already exists in this repo

Everything below is built and in `main` unless marked. This is what the design must fit, not
replace.

**Entitlement.**
`waves_profile_is_paid(uuid)` — a `SECURITY DEFINER` SQL function: true iff the profile has an
`active` subscription with `current_period_end` null or in the future
(`packages/db/prisma/migrations/20260904000000_waves_baseline/migration.sql`, line ~4981).
`waves_group_is_paid(uuid)` is true if _any_ member is paid. `waves_my_plan()` returns tier and
`scanLimit`, upgraded to `plus` when the group holds an unexpired `group_passes` row. The
`subscriptions` table constrains `store` to `play | appstore | promo` and carries a unique
`store_txn_id` so a replayed webhook cannot grant twice.

**But nothing can buy one.** `apps/mobile/src/app/settings/upgrade.tsx` states in its header that
there is no paid tier to sell; `apps/mobile/src/app/paywall.tsx` is placeholder UI with
hardcoded English copy and no store call; there is no `react-native-purchases` or equivalent in
`apps/mobile/package.json`. **This is the plan's first dependency.**

**Tunable knobs.** `app_config(key text pk, value int, description, updated_at)` — service-role
write, edited at `apps/admin/src/app/config/page.tsx`. Seeded with `receipt_cap_per_group=3`,
`free_storage_cap_bytes=10485760`, `attachment_cap_per_expense=2`, `voice_stt_free_seconds=300`,
`voice_stt_max_clip_seconds=60`, `voice_llm_schema_version=1`, `device_cap_free=2`,
`device_cap_plus=3`. `service_config(key, value text)` holds provider/model _names_ (secrets never
live there; they are edge-function env). `feature_flags(key, enabled, rollout_percent, variants[])`
is read on the phone by `apps/mobile/src/lib/flags.tsx`, which computes the arm locally with
`variantFor`/`bucketOf` (`packages/core/src/flags/bucket.ts`, FNV-1a) so a screen never waits on a
round trip and **off is the fallback for everything**. The device cap's A/B arms
(`device_cap_free_ab`, arm name = the number) are the precedent for A/B-ing a numeric limit.

**Metering, and a real gap.** `usage_events(profile_id, group_id, kind, input_tokens,
output_tokens, cost_minor bigint, currency, metadata, created_at)` — written by
`waves_record_receipt` with `kind='receipt_scan'` and counted by `waves_scans_used_this_month()`.
`waves_admin_ai_cost(days)` aggregates it and `apps/admin/src/app/page.tsx` renders `cost_minor`.
**`cost_minor` is never written by anything** — `receipt-parse` inserts token counts only. The COGS
column on the admin dashboard is empty today. **Fixing that is a prerequisite for pricing a coin
against observed cost rather than a list price** (§7.7).

**The voice cloud tier (A48), Phase 1 shipped dark.** `docs/voice-cloud-stt-and-structuring.md` is
the design. Built: `voice_stt_usage(profile_id, period 'YYYY-MM', seconds)` with
`waves_voice_stt_remaining_seconds`, `waves_voice_stt_record` (service-role), and the
client-facing `waves_my_voice_access()`; `apps/mobile/src/lib/voiceAccess.ts` holds the pure
`pickVoiceMode(access, {online, cloudEnabled})` selector. **Not built:** the `voice-stt` and
`voice-structure` edge functions — `supabase/functions/` contains 16 functions and neither is
among them. So voice today is **on-device only**: `expo-speech-recognition` plus the heuristic
parser in `apps/mobile/src/lib/voiceExpense.ts`. The earlier bring-your-own-key LLM tier was
**removed** (#589). "Advanced voice" in the request means finishing A48 Phases 2–3.

**Receipt OCR.** On-device ML Kit first (`@react-native-ml-kit/text-recognition`, TDR A5); the
image only leaves the phone when that fails, and then `supabase/functions/receipt-parse/index.ts`
feeds bytes to a vision LLM with a strict JSON schema. Three refusals sit in front of the model
call, all server-side: `enforceRateLimit`, `waves_receipt_scan_quota()` (20/month free, 300 paid),
and `waves_can_add_receipt` (`app_config.receipt_cap_per_group`).

**Personal ledger — where statement transactions would land.** `personal_records(owner_user_id,
record_kind 'txn'|'recurring'|'loan'|'budget', data jsonb, updated_seq, deleted_at)`, synced on the
**personal scope** `personalScope(profileId) = ${profileId}:personal`
(`packages/core/src/sync/protocol.ts`), with `personal.upsert` / `personal.delete` mutation kinds.
The `PersonalTxn` shape (`packages/core/src/personal/types.ts`) is
`{id, kind, amount bigint, currency, category, note, date 'YYYY-MM-DD', loanId, recurringId}` — a
bank-statement row maps onto it one-to-one. The `Me` tab already renders the month "grouped by day
like a bank statement".

**The retained precedent for on-device financial parsing.** `packages/core/src/sms/parse.ts` — the
bank-SMS parser, kept deliberately after the screen was removed (TDR A2). Its header states the
rule this plan should extend: _"it does not touch the network, and nothing here is called from an
edge function. A bank SMS carries an account tail, a balance, and sometimes a one-time password;
sending it anywhere to be parsed would be a worse privacy trade than the feature is worth"_, and
_"it does not write — `proposeFromSms` returns candidates, and a person confirms each one."_

**Storage and encryption.** Images go to Cloudflare R2 behind `r2-sign` (presigned PUT/GET, the
client holds no credential); free accounts have a 10 MB ceiling reserved at presign
(`waves_storage_reserve`) and re-checked at commit. Party-only attachments
(`docs/private-attachments.md`) are brokered **by subject, not by path**, with 60-second presigns
because an R2 presign cannot be revoked, and **no service-role dual-read fallback**. The local
SQLite mirror's `json` columns are sealed with XChaCha20-Poly1305 keyed from the OS keystore, with
per-row AAD; sign-out is a crypto-erase (ADR-005 addendum, TDR A48). There is also an encrypted
**personal-cloud backup** to the user's own Drive/Dropbox/OneDrive
(`apps/mobile/src/lib/backup/`, `apps/mobile/src/lib/cloud/`).

**Unauthenticated edge functions already exist.** `supabase/config.toml` sets
`verify_jwt = false` for `email-events`, `email-unsubscribe` and `otp-send`. `email-events`
verifies a Svix signature over the exact bytes before doing anything
(`verifyWebhookSignature` in `_shared/core.js`) and its header says the flag _"must stay there"_.
**That is the exact shape the SSV callback needs**, so the SSV endpoint is not a new trust model —
it is the third instance of an existing one.

**Rate limiting.** `waves_rate_limit(subject, bucket, limit, window_seconds)` counts in Postgres
(never in-memory — the isolate note in `supabase/functions/_shared/rateLimit.ts` is explicit about
why), with a master switch and per-bucket overrides editable at
`apps/admin/src/app/rate-limits/page.tsx`.

**Surfaces where an ad may never appear.** Three launcher widgets
(`apps/mobile/plugins/withWavesWidgets`), Apple Watch and Wear OS companions
(`withWavesWear`, `@bacons/apple-targets`). Apple 2.5.18 names widgets and watchOS explicitly.

**Analytics already behind consent.** `@microsoft/react-native-clarity` sits behind a consent
toggle (`apps/mobile/src/lib/clarity.ts`); `@sentry/react-native` is wired. Neither is governed by
Google's UMP — §6.6.

---

## 4. The coin economy design

### 4.1 The recommended shape: one ad, one unlock — with coins as a later, optional layer

Ship **Tier 0** first and only add **Tier 1** when §7's arithmetic says there are three things of
genuinely different cost to choose between.

|                      | Tier 0 — direct unlock (ship this)                            | Tier 1 — coins (later, if warranted)              |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Instrument           | none; an ad grants one entitlement token for one named action | `coin_entries`, a signed append-only ledger       |
| Consumer-law surface | almost none                                                   | CPC virtual-currency principles, DFA              |
| Store obligations    | none                                                          | none while earn-only (§4.6)                       |
| Farm value           | one action                                                    | a balance                                         |
| When it wins         | all unlockables cost about one ad                             | user must choose between things of different cost |

Tier 0 still needs the entire SSV mint path in §6 — the token is minted on the verified callback
exactly as a coin would be. **The architecture is the same; only the denomination differs.** That
is why §6 is written in terms of coins throughout: build the ledger with a coin value of 1 and a
single price of 1, and Tier 1 is a config change rather than a migration.

### 4.2 Earn

**One action earns: completing one opt-in rewarded video.** Nothing else.

Explicitly _not_ earnable, each for a stated reason:

| Not rewarded                                          | Why                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opening the app, daily check-in, streaks              | The TikTok Lite task list. Also ICO Children's Code: providers should not use _"reward loops… that exploit human susceptibility to reward/pleasure seeking behaviours in order to keep children engaged"_ (_quoted_, [ICO nudge techniques](https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/toolkits/age-appropriate-design/nudge-techniques/)) |
| Inviting friends, referrals                           | Engagement/recruitment reward — the TikTok list again                                                                                                                                                                                                                                                                                                                                           |
| Rating the app, reviews, social posts, contact upload | Apple 3.2.2(x) forbids _forcing_ these; 3.1.5(v) shows the shape Apple dislikes                                                                                                                                                                                                                                                                                                                 |
| Adding an expense, settling up                        | ADR-011 rule (1). Rewarding the core loop turns the ledger into a game                                                                                                                                                                                                                                                                                                                          |

Apple explicitly permits the loop this plan proposes. Guideline **3.2.2(x)**, _quoted_: _"Apps must
not force users to rate the app, review the app, download other apps, or other store-related
actions in order to access functionality… **Apps may otherwise incentivize users to take specific
actions within apps (e.g. completing a level, watching an ad).**"_ Cite that line in review notes.

**Caps, all as `app_config` knobs so they can be tuned without a release:**

| Knob                         | Proposed default | Reasoning                                                                                                                                                                                    |
| ---------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coin_per_ad`                | `1`              | Fixed and stated. Never randomised — §4.5                                                                                                                                                    |
| `coin_daily_earn_cap`        | `3`              | Organic rewarded rate is 0.1–0.5 impressions/DAU (_estimate_); 3 is an order of magnitude above honest use, so it constrains nobody real while bounding a compromised account's daily damage |
| `coin_earn_cooldown_seconds` | `120`            | Velocity check; also stops a rage-tap loop                                                                                                                                                   |
| `coin_expiry_days`           | `365`            | Google Opinion Rewards' one year, with the date shown next to the balance                                                                                                                    |
| `coin_lifetime_cap`          | `50`             | Hard ceiling on an un-spent balance. Anti-hoarding, and it bounds the clawback exposure in §6.5                                                                                              |

**The daily cap is enforced server-side in the mint path, never by AdMob's frequency cap.** Google's
own documentation says a frequency-cap change _"can take up to 24 hours to take effect"_ and that
_"a slight server delay can occasionally result in the frequency cap that you've set being
exceeded"_ (_quoted_, [AdMob frequency capping](https://support.google.com/admob/answer/6244508)).
A control you cannot close today and that admits to leaking is a backstop, not a limit. Set the
AdMob cap somewhat _above_ the server cap so the two do not fight.

### 4.3 Spend

**Prices as `app_config` knobs, with the real-money equivalent displayed beside every one.**

| Feature                                                                                                                                           | Recommended treatment                                                                      | Why                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloud STT + LLM structuring (A48 Phases 2–3)                                                                                                      | **Free within the existing monthly allowance** (`voice_stt_free_seconds`); no coins at all | Costs $0.00015/use (§7.3). Metering it is friction, not economics                                                                                            |
| Cloud receipt read by a VLM                                                                                                                       | **Free within the existing `waves_receipt_scan_quota`** (20/month free)                    | Costs ~$0.00022/receipt on Flash-Lite (§7.4)                                                                                                                 |
| Cloud receipt via a specialist parser (Textract/Veryfi)                                                                                           | Coin-priced _if_ chosen                                                                    | $0.01–$0.08/receipt. But Veryfi's **$500/month minimum** (_list_) makes it a fixed cost, which is the wrong shape for coins entirely                         |
| **Bank statement import**                                                                                                                         | **The one real sink** — and probably paid, not earned (§7.6, §8)                           | $0.006–$40 per 20-page statement depending on vendor (_derived_ / _estimate_)                                                                                |
| Extra receipt beyond `receipt_cap_per_group`, extra storage beyond `free_storage_cap_bytes`, extra attachment beyond `attachment_cap_per_expense` | Coin-priced, and these are the _better_ Tier-1 sinks                                       | Non-AI, near-zero marginal cost, already server-enforced, already knob-tuned. They give a coin somewhere to go that does not depend on a vendor's price list |

**Never coin-priced, ever:** adding, editing or deleting an expense; any split type; settling up;
recording a settlement; balances; export; import; creating or joining a group; adding a person.
ADR-011 rule (1) is constitutional and this plan does not touch it.

**Every coin-gated feature must have a non-coin path.** Subscribe, or use the free monthly
allowance. This is not only good manners: §6.6 establishes that in the EEA a user who declines ad
consent gets **zero ad fills, not cheaper ads**, so a coin-only feature is a hard paywall for those
users, and §4.5 establishes that minors may earn only at a heavily discounted rate. Two
populations structurally cannot reach a coin-only feature. A feature reachable only by coins is
therefore not shipped until both have another door.

### 4.4 Expiry, and why it is available at all

**One year from the date earned, per lot, with the expiry date rendered beside the balance.**

This is only available because coins are **earn-only**. Google Play's Payments policy is explicit
(_quoted_, [Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818)):

> **"Earned or awarded points can be issued in-app without using Google Play's billing system.
> Users can also exchange those earned or rewarded points in-app for digital goods and services
> without Google Play's billing system."**

with the limit _"if these points (or other types of virtual currency) are sold in-app, Google
Play's billing system must be used."_ Apple's constraint is scoped the same way (_quoted_, 3.1.1):
_"Any credits or in-game currencies **purchased via in-app purchase** may not expire, and you
should make sure you have a restore mechanism."_

**So: do not sell coins in v1.** An earn-only coin sits outside both stores' billing obligations
_and_ outside Apple's no-expiry rule. The moment coins are sold, the purchased portion can never
expire — and if earned and purchased coins share one balance, the stricter rule governs the whole
pot and you can never expire anything again. **If selling coins is ever contemplated, keep two
ledgers**, so the earned pot never inherits the obligation. Note the store policies are _silent_
on earned-only currency rather than granting an exemption; §4.6 and §10 treat that as monitored
risk, not settled fact.

### 4.5 How it feels — not cheap, not a casino

The user asked for this not to feel cheap. Six rules, each traceable to a source rather than to
taste:

1. **Fixed, stated, predictable.** One ad = N coins, always. **No randomised grants.** Randomisation
   invites the loot-box analysis (Apple requires odds disclosure for randomised items; Belgium
   carries criminal fines to €800,000), and Duolingo's randomised mini-game energy refills were
   part of what users found insulting.
2. **No time pressure.** The CPC named _"purchase through time-limited practices"_ as an unlawful
   pressuring technique. No countdown timers, no "2× coins for the next 10 minutes", no streak-loss
   threat attached to the balance.
3. **Always show the real price beside the coin price** — _"1 coin · about one ad, or included with
   Plus"_. This satisfies the CPC's "clear and transparent pricing", pre-empts the DFA's most
   likely concrete requirement, and is the single cheapest thing in this document to build now and
   most expensive to retrofit.
4. **Pre-load before you offer.** Do not render the earn affordance until the ad has actually
   loaded. In a tier-3-weighted user base roughly **half** of rewarded requests go unfilled on a
   single network (_secondary_: [Playwire](https://www.playwire.com/blog/admob-ecpm-benchmarks-what-publishers-should-expect),
   50–70% fill at ~20% tier-1 traffic), and a button that fails is worse than no button. There is
   also a trap: **a hit frequency cap is reported to the client as a no-fill error**, so the app
   cannot tell "you have earned your maximum" from "no advertiser wants this impression" — only
   _your_ server-side count knows. Say the right thing from server state.
5. **One coin, one earn action, a short spend menu.** Reddit retired 50+ virtual instruments for
   complexity, not fraud.
6. **Nothing for minors.** No coin mechanics at all on an account flagged `TEEN`, and the coin UI
   must never use child-appealing framing. Rewarded video for a teen account stays a flat,
   non-escalating, user-initiated exchange or does not exist. This is the ICO Children's Code
   point and it is the sharpest constraint on the whole design.

**On age.** Google replaced `tagForChildDirectedTreatment` and `tagForUnderAgeOfConsent` with a
single **TFAT (Tag For Age Treatment)** signal announced **2026-05-18**
([AdMob/Ad Manager help](https://support.google.com/admanager/answer/3671211)): `CHILD` disables
personalised ads, remarketing, third-party vendor requests and transmission of the AAID/IDFA;
**`TEEN` is a new tier** disabling personalised ads and remarketing and applying teen-specific
category restrictions (alcohol, gambling, dating, weight loss, body modification); legacy tags keep
working through 2026 with removal expected H1 2027. **So teens can still be served rewarded ads —
non-personalised and category-restricted — at the same 60–80% eCPM haircut as any
non-personalised inventory.** Note UMP **does not forward the age tag to the Mobile Ads SDK**
(_quoted_, [US IAB support](https://developers.google.com/admob/android/privacy/us-iab-support));
it must be set on the ad request separately.

The best available basis for setting it is the **store-supplied age category**: the Texas App
Store Accountability Act took effect **2026-01-01** (the Fifth Circuit stayed the preliminary
injunction) and Utah's developer requirements on **2026-05-06**, and **both give developers a safe
harbour for reasonable reliance on the age category supplied by the store** — Louisiana (pushed to
2027-07-01) explicitly does not. Obligations apply to all developers, not only those targeting
minors (_secondary_: [Venable](https://www.venable.com/insights/publications/2025/12/new-app-developer-compliance-requirements),
[FPF comparison chart](https://fpf.org/wp-content/uploads/2026/06/FPF-Legislation-TX-UT-LA-App-Store-Accountability-Act-Comparison-Chart.pdf)).
Design the age input as **store signal first, neutral age screen as fallback** — never a
self-declared birthday, which users lie to and regulators discount.

**Declare 13+ on Play and stay out of the Families programme.** Families rules prohibit _"rewarded
or opt-in ads that are not closeable after 5 seconds"_ (_quoted_,
[Families policy](https://support.google.com/googleplay/android-developer/answer/9893335)), which
would destroy the mechanic outright — nobody completes a 30s ad they can skip at 5s. Also: the
Families Self-Certified Ads SDK Program **is not currently accepting new applicants**, so joining is
not an option even if you wanted it. **Never change the Play target-audience declaration casually.**

### 4.6 What the coin may never be

AdMob's rewarded policy is the sharpest constraint on a coin economy inside a money app
(_quoted_, [Policies for ad units that offer rewards](https://support.google.com/admob/answer/7313578)):

- **"Direct monetary items may not be offered as rewards under any circumstance."**
- Rewards must be non-transferable and _"only redeemable and usable for an item or service within
  the publisher's platform."_
- _"Rewarded Ads must only be served after a user affirmatively and unambiguously opts in."_
- _"Rewarded Ads must not oblige users to interact with it."_
- No _"text or icons, other than to describe the reward(s) offered, to mislead or incentivize users
  towards a particular choice (such as by indicating 'watch this ad to support our business')."_
- Publishers _"must not state or imply that rewards are verified or endorsed by Google."_

**In an app that already tracks who owes whom real money, this boundary is unusually easy to cross
by accident.** Anything touching a user's ledger balance is a direct monetary item however it is
framed: "coins waive your settlement fee" is prohibited; "coins unlock a statement import" is not.
And coins must be **strictly non-transferable** — no gifting, no pooling in a group, no
group-shared balance — because a transferable token sitting next to a ledger of debts starts to
look like a payment instrument, which drags in Apple 3.2.1(vii) and worse.

**No randomised or gacha mechanics at all.** It costs nothing in a finance app and removes the
gambling question entirely. Play's Real-Money Gambling policy prohibits _"users' ability to wager,
stake, or participate using real money… to obtain a prize of real world monetary value"_ — out of
scope for a free-earned, app-locked coin, and it should stay that way by construction.

Note the asymmetry in the invalid-traffic policy: **incentivising a _view_ is exactly what rewarded
ads are for; incentivising a _click_ is a violation.** Reward copy describes the reward and nothing
else.

---

## 5. Architecture

### 5.1 Tables

Four new tables. All Prisma models in `packages/db/prisma/schema.prisma` with a matching migration
under `packages/db/prisma/migrations/`, RLS on every one (ADR-013), and an entry in
`packages/db/test/rls.test.ts`.

```
coin_entries                          -- append-only, ADR-004 shape
  id            uuid pk
  profile_id    uuid not null -> profiles(id) on delete cascade
  delta         integer not null      -- +N mint/grant, -N spend/expiry/reversal
  kind          text not null         -- 'ad_mint'|'promo_grant'|'spend'|'expiry'|'reversal'
  feature       text                  -- what a spend bought; null otherwise
  ref_id        text                  -- transaction_id for a mint, request id for a spend
  expires_at    timestamptz           -- set on positive entries only; null on negatives
  created_at    timestamptz not null default now()
  -- RLS: SELECT own. No client write path at all: INSERT/UPDATE/DELETE are service_role
  --      and the definer RPCs below, never `authenticated`.
  index (profile_id, created_at desc)
  index (profile_id, expires_at) where delta > 0 and expires_at is not null

ad_earn_nonces                        -- the server-issued, single-use earn ticket
  nonce         text pk               -- 32 random bytes, base64url; goes in custom_data
  profile_id    uuid not null
  device_id     text                  -- device_sessions.device_id, for velocity checks
  ad_unit       text not null
  state         text not null default 'pending'   -- 'pending'|'consumed'|'expired'
  issued_at     timestamptz not null default now()
  expires_at    timestamptz not null              -- issued_at + 10 minutes
  consumed_at   timestamptz
  transaction_id text                             -- the callback that consumed it
  -- RLS: no client read at all. service_role only.
  index (profile_id, issued_at desc)

ad_ssv_callbacks                      -- every callback ever seen; the replay defence
  transaction_id text pk              -- Google's, hex. THE idempotency key.
  key_id         text not null
  ad_unit        text
  ad_network     text
  reward_amount  integer
  reward_item    text
  ad_timestamp   bigint               -- as sent, before any unit interpretation
  nonce          text
  profile_id     uuid
  outcome        text not null        -- 'minted'|'duplicate'|'bad_signature'|'stale'
                                      -- |'unknown_nonce'|'nonce_reused'|'cap_reached'|'paid_user'
  received_at    timestamptz not null default now()
  -- RLS: no client access. service_role only.
  index (received_at desc)
  index (profile_id, received_at desc)

ad_invalidations                      -- clawback reconciliation, §6.5
  id             uuid pk
  period         date not null        -- the AdMob reporting day
  ad_unit        text
  estimated_minor  bigint             -- what we minted against
  finalised_minor  bigint             -- what AdMob actually paid
  imported_at    timestamptz not null default now()
  -- RLS: service_role only; read by the admin console through a definer RPC.
```

Why `coin_entries` rather than a `balance` column: this repo derives balances from an append-only
ledger everywhere else (ADR-004), the reasons are the same here (an audit trail, a reversible
history, no lost update), and per-lot expiry needs the lot. Balance is
`sum(delta)` over non-expired entries; consumption is **FIFO by `expires_at`** so the soonest-to-die
coin is spent first — which is what makes a visible expiry date honest rather than a trap.

### 5.2 Knobs and flags

`app_config` (int only) gains: `coin_per_ad`, `coin_daily_earn_cap`, `coin_earn_cooldown_seconds`,
`coin_expiry_days`, `coin_lifetime_cap`, `coin_price_statement`, `coin_price_receipt_extra`,
`coin_ssv_max_age_seconds`. Each appears automatically at `apps/admin/src/app/config/page.tsx`
(that page renders whatever rows exist). A/B arms follow the `device_cap_*_ab` precedent: a
`feature_flags` row named `coin_daily_earn_cap_ab` whose variant names are the numbers, resolved by
`waves_variant` server-side and `variantFor` on the phone from the same FNV-1a hash.

`service_config` (text) gains: `ads_rewarded_unit_android`, `ads_rewarded_unit_ios`,
`ads_network` (`admob` today; the seam exists so a later mediation decision is a config change).
**No key, secret or app id that must stay private goes here** — `service_config` is readable.

`feature_flags` gains `ads_enabled` and `coins_enabled`, both defaulting off, both read through
`apps/mobile/src/lib/flags.tsx` where **off is the fallback for no session, no cache and a failed
fetch**. The whole feature therefore ships dark and turns on per-cohort, exactly as A48 Phase 1
did.

### 5.3 Definer RPCs

Following ADR-013's addendum (a boundary-crossing mutation may be a `SECURITY DEFINER` RPC where
that carries less privilege than an edge function), and the `check-definer-grants.mjs` rule that
every definer function states its caller model with a GRANT/REVOKE in the same migration — noting
the house trap that Supabase grants EXECUTE **directly to `anon`** on creation, so the pattern is
`REVOKE … FROM PUBLIC, anon`.

| Function                                                                                                       | Caller          | Does                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `waves_my_coin_access()` → jsonb                                                                               | `authenticated` | `{paid, balance, expiring:[{amount, expiresAt}], earnedToday, dailyCap, cooldownUntil, enabled}` — the `waves_my_voice_access()` precedent, one round trip, safe when signed out |
| `waves_ad_issue_nonce(p_device_id text, p_ad_unit text)` → text                                                | `service_role`  | Pre-checks paid (refuse — a paying user has no earn path), daily cap, cooldown, lifetime cap; inserts the nonce; returns it                                                      |
| `waves_coin_mint(p_txn text, p_key_id text, p_nonce text, p_amount int, p_ad_ts bigint, p_meta jsonb)` → jsonb | `service_role`  | The whole mint, one transaction. §6.4                                                                                                                                            |
| `waves_coin_reserve(p_feature text, p_price int, p_idem uuid)` → jsonb                                         | `service_role`  | Conditional debit that only succeeds within balance; the `voice-stt` reserve/reconcile shape                                                                                     |
| `waves_coin_release(p_idem uuid)` → void                                                                       | `service_role`  | Refunds a reservation when the vendor call fails. A user must never pay for a failure                                                                                            |
| `waves_coin_expire_due()` → int                                                                                | `service_role`  | Writes negative `expiry` entries for lots past `expires_at`. Called by a `pg_cron` job beside the 18-month auto-archive job                                                      |

`waves_coin_mint` is a function body, therefore one transaction — the same reasoning as TDR A4
(`waves_import_splitwise` is an RPC, not an edge function, because "a function body is one
transaction; an edge function looping over REST calls is not").

### 5.4 Edge functions

Two new, in `supabase/functions/`, following the existing `_shared/auth.ts` two-client convention
(`asCaller` under the caller's JWT with RLS applied; `asService` only after an explicit
authorisation check).

**`ads-nonce`** — authenticated. `enforceRateLimit` with a new `LIMITS['ads-nonce']` bucket, then
`waves_ad_issue_nonce`. Returns `{nonce, adUnit}` or a clean refusal
(`COIN_DAILY_CAP`, `COIN_COOLDOWN`, `COIN_PAID_NO_ADS`, `ADS_DISABLED`) so the client can say the
right thing rather than surfacing a raw error — the `friendlyError` rule from #256.

**`ads-ssv`** — **unauthenticated**, `verify_jwt = false` in `supabase/config.toml` beside
`email-events`, `email-unsubscribe` and `otp-send`. Google calls it; there is no JWT to have. Its
trust root is the ECDSA signature, exactly as `email-events`' is the Svix signature over the exact
bytes. §6 specifies it completely.

Later, for statement import: **`statement-parse`**, modelled on `receipt-parse` — membership is
irrelevant (it is personal-scope), so the checks are ownership, rate limit, entitlement, and a coin
reserve, all before a vendor token is spent.

### 5.5 Client

Native dependency: `react-native-google-mobile-ads` plus its Expo config plugin. **This is a native
change: it cannot ship over the air**, and per the repo's standing rule a native module must be
lazily required behind a non-throwing check or the app dies at launch. Note the config-plugin
failure mode is _worse_ than that rule covers — the library's docs state the app **crashes without
valid app IDs in config**, which is a build/launch failure a runtime guard cannot catch. The plugin
keys are the Expo camelCase form (`androidAppId`, `iosAppId`, `skAdNetworkItems`,
`userTrackingUsageDescription`) and differ from the bare-RN snake_case form.

New files, mirroring the A48 Phase 1 layout so the decision is unit-tested before any network tier
exists:

```
apps/mobile/src/lib/ads/
  consent.ts        UMP: requestConsentInfoUpdate → loadAndPresentIfRequired → canRequestAds
  rewarded.ts       load / show / event wiring; NEVER mints
  coinAccess.ts     the VoiceAccess-shaped type + pure pickAdMode(access, ctx) selector
  useCoinAccess.ts  react-query hook over waves_my_coin_access
apps/mobile/src/app/coins.tsx   balance, expiry dates, earn button, real-money equivalent
```

`pickAdMode` is pure and testable, and returns `'unavailable'` (not an error) for: offline, flag
off, `canRequestAds === false`, entitlement unknown, paid, teen, daily cap reached, no ad loaded.
The default is `'unavailable'` — the `pickVoiceMode` rule that you never gamble on unknown state.

**The client never mints.** `RewardedAdEventType.EARNED_REWARD` fires on the device with the amount
configured in the AdMob dashboard; treat it as a UI signal only ("your coins are on the way") and
reconcile against server state. The client event and the server callback are independent and racy —
the client may fire first, last, or (offline) never.

### 5.6 Offline: coins are not mintable offline, and the queue never sees one

This is the ADR-005 question and it has a clean answer in three parts.

**Minting.** There is **no mutation kind for a mint.** `MutationKind` in
`packages/core/src/sync/protocol.ts` gains nothing; the phone has no code path that can add a
positive `coin_entries` row. A mint originates at Google's servers and lands on `ads-ssv`. An
offline device cannot earn because the ad cannot serve, and even if it could, nothing on the device
is trusted to say so. **This is not a policy the client enforces — it is an absence of mechanism.**

**Reading.** Coin balance and expiry ride the **read** side, on a new personal scope
`coinScope(profileId) = ${profileId}:coins`, suffixed like `personalScope`,
`categoryTagsScope`, `ghostMergesScope` and `packInstallsScope`, so it keeps its own cursor and the
existing envelope machinery serves it unchanged. `coin_entries` is pulled read-as-the-caller by
`sync` under its own RLS, and the balance is summed on the device from the mirror like every other
figure in the app. So the balance renders offline; it just never _grows_ offline.

**Spending.** Every coin-gated feature calls an edge function by construction — cloud STT, cloud
OCR, statement parse. A spend is therefore online-only not by policy but by physics, and it does
**not** ride the queue. The debit happens _inside_ the same server transaction that admits the
vendor call — `waves_coin_reserve` before the call, `waves_coin_release` on vendor failure, exactly
the reserve/reconcile shape `voice-stt` was designed with. This is a stronger statement than
ADR-005's existing addendum (which lists writes that are online-only _by choice_ because they move
no balance): an optimistic coin debit is not merely inconvenient, it is **wrong** — it would render
a balance the user does not have, and a refusal would then have to un-render it. This app has
already learned that dropping a refused mutation from the queue can delete what it made (#669);
the safe version is never to enqueue it.

### 5.7 Admin and observability

- `apps/admin/src/app/config/page.tsx` picks up the new `app_config` rows with no code change.
- New `waves_admin_coin_economy(days int)`, beside `waves_admin_ai_cost`: mints, spends, expiries,
  distinct earners, refusal reasons broken out by `ad_ssv_callbacks.outcome`, and — the number that
  matters — **coins minted vs finalised ad revenue** for the same period, from `ad_invalidations`.
- **Write `usage_events.cost_minor`.** It is rendered on the admin dashboard today and written by
  nothing; every vendor call (receipt parse, cloud STT, structuring, statement parse) must record
  its own cost in minor units so the coin price can be set from _observed_ COGS rather than a list
  price that changed last quarter. This is a prerequisite, not a nicety.
- A refusal-reason breakdown is the single most useful diagnostic: `bad_signature` spiking means a
  key rotation was mishandled, `duplicate` spiking means the endpoint is slow enough to be retried,
  `nonce_reused` spiking means somebody is trying.

---

## 6. Fraud model

### 6.1 The correction, stated once

Client-side ad-blocker and DNS-blocker detection is the wrong primitive. It is fragile, trivially
defeated by anybody motivated enough to be worth stopping, and produces false positives against
Pi-hole, NextDNS, AdGuard, private DNS, corporate and school resolvers, and VPNs — legitimate
privacy configurations whose owners would be punished for a setting, not an act. **Server-Side
Verification makes the detector unnecessary:** if the ad never served, Google never calls your
server, and there is nothing to withhold. Blocker and VPN signals may inform a risk _score_ that
changes review priority; they never gate a mint.

### 6.2 The SSV callback, mechanically

Primary source throughout: [Google's AdMob SSV documentation](https://developers.google.com/admob/android/ssv)
(fetched 2026-09-08).

_Quoted_: _"Server-side verification callbacks are URL requests, with query parameters expanded by
Google, that are sent by Google to an external system to notify it that a user should be rewarded."_
HTTP **GET**, query parameters only. The callback URL is configured **per ad unit in the AdMob
console**, not in code. _Quoted_: _"Google will re-attempt to send SSV callbacks up to five times
in one-second intervals"_ if the endpoint does not return **HTTP 200 OK**.

Parameters: `ad_network`, `ad_unit`, `custom_data`, `reward_amount`, `reward_item`, `timestamp`,
`transaction_id`, `user_id`, `signature`, `key_id`. **Note the absences: no country, no IP, no
device identifier, no revenue value.** `custom_data` and `user_id` are absent entirely if unset.

**Signature.** ECDSA with SHA-256 over **every query parameter except `signature` and `key_id`, in
their original order, as a UTF-8 byte array**. _Quoted_: _"The last two query parameters of rewarded
SSV callbacks are always `signature` and `key_id`, in that order"_ and _"Content from the SSV
callback should not be modified in any way (including keeping the order of query parameters)."_

> **The implementation bug that catches everyone, written as a testable requirement.** Any code
> that parses the query into a map and re-serialises it will reorder or re-encode parameters and
> **every signature will fail**. In the Deno edge function, verify against `req.url` **raw**: find
> the literal `&signature=`, take the prefix, and hand those exact bytes to WebCrypto
> (`ECDSA` / `P-256` / `SHA-256`). Do **not** use `new URL(req.url).searchParams` for the signed
> content, and do not let any middleware normalise the query first. Ship a fixture test built from
> a captured real callback.

**Keys.** Fetched from `https://gstatic.com/admob/reward/verifier-keys.json` (JSON of `keyId`,
`pem`, `base64`). _Quoted_: _"public keys are regularly rotated and should not be cached for longer
than 24 hours"_ and _"rotated on a variable schedule."_ **Cache keyed by `key_id`, TTL ≤ 24h, and
on an unknown `key_id` re-fetch once before rejecting** — a rotation landing between a cache fill
and a callback would otherwise reject valid rewards, and that failure looks exactly like an attack,
which makes it easy to misdiagnose. A hard-coded key breaks silently at the next rotation.

### 6.3 What the callback proves, and what it does not

**The signature proves Google sent the callback. It does not prove the app set `user_id` and
`custom_data` honestly.** Both are set from the client via
`RewardedAd.createForAdRequest(adUnitId, {serverSideVerificationOptions: {userId, customData}})`,
and the library's own docs say _"You must independently verify incoming requests to ensure
authenticity."_ A repackaged client can set `user_id` to anybody's id. Treat both as **untrusted
client input faithfully relayed**.

Therefore: **`user_id` carries nothing load-bearing, and `custom_data` carries only a
server-issued, single-use, short-lived nonce.**

```mermaid
sequenceDiagram
    participant App as Waves app
    participant N as ads-nonce (edge, JWT)
    participant DB as Postgres
    participant G as Google AdMob
    participant S as ads-ssv (edge, no JWT)

    App->>N: POST (user JWT), deviceId
    N->>DB: waves_ad_issue_nonce — paid? cap? cooldown? lifetime?
    DB-->>N: nonce (pending, 10 min TTL)
    N-->>App: { nonce, adUnit }
    App->>G: load rewarded ad, customData = nonce
    G-->>App: ad shown, user completes it
    G-->>App: EARNED_REWARD (UI signal only — mints nothing)
    G->>S: GET ?...&transaction_id=..&signature=..&key_id=..
    S->>S: verify ECDSA over raw query prefix; key cached <=24h by key_id
    S->>S: reject if timestamp older than coin_ssv_max_age_seconds
    S->>DB: waves_coin_mint(txn, keyId, nonce, amount, ts)
    Note over DB: one transaction:<br/>1. INSERT ad_ssv_callbacks (transaction_id PK)<br/>   unique violation => outcome 'duplicate', no mint<br/>2. UPDATE ad_earn_nonces SET state='consumed'<br/>   WHERE nonce=$1 AND state='pending' AND expires_at>now()<br/>   RETURNING profile_id — no row => 'nonce_reused'<br/>3. re-check daily cap and lifetime cap<br/>4. INSERT coin_entries (+N, expires_at)
    DB-->>S: { minted: true|false, reason }
    S-->>G: 200 OK (always, once durable)
    App->>DB: sync pull on coinScope — balance appears
```

### 6.4 Replay protection, specified rather than described

This repo has been bitten by idempotency bugs before (the monkey-suite finding behind #224; the
invite consume-idempotency work in #460), so this is specified at schema level.

1. **`ad_ssv_callbacks.transaction_id` is the primary key.** Google documents it as _"Unique hex
   encoded identifier for each reward grant event"_ (_quoted_). The mint is **atomic with the
   insert**: `INSERT … ` first, and let the unique violation _be_ the dedup signal. A
   "have I seen this?" `SELECT` followed by a credit races against the retry and will lose.
2. **Duplicates are not theoretical.** The documented 5×/1-second retry means any handler slower
   than ~1s, or any transient non-200, produces genuine repeat deliveries of the same
   `transaction_id`. A Supabase edge function doing a write under load can exceed 1s.
3. **On a duplicate, record the outcome and return 200.** Returning an error would earn four more
   retries.
4. **The nonce is consumed by a conditional UPDATE, not a read-then-write.**
   `UPDATE ad_earn_nonces SET state='consumed', … WHERE nonce = $1 AND state = 'pending' AND
expires_at > now() RETURNING profile_id`. No row returned means reused or expired; refuse and
   record why. Both keys are needed: `transaction_id` alone leaves a nonce reusable across two
   views; the nonce alone leaves the callback replayable.
5. **Freshness.** Google publishes **no maximum callback age and no idempotency guidance at all** —
   that gap is yours. Reject on `timestamp` older than `app_config.coin_ssv_max_age_seconds`
   (proposed default 300). **Caveat before writing comparison logic:** the docs say epoch
   milliseconds but the example value (`1507770365237823`) has microsecond-looking precision.
   Validate the magnitude against a live callback.
6. **`reward_amount` is configured in the AdMob dashboard, not by your server.** Validate it against
   the expected value; never trust it as authority for how much to mint. Mint
   `app_config.coin_per_ad`.
7. **Return 200 as soon as the mint is durable.** Push notifications, analytics and sync fan-out
   happen after, or the retry storm becomes the load.

### 6.5 The financial risk nobody expects: invalid-traffic clawback

**This, not multi-accounting, is the centre of the fraud model.**

Google's policy is explicit (_quoted_, [invalid traffic](https://support.google.com/admob/answer/3342054)):
publishers _"may see discrepancies between estimated and finalized earnings due to invalid traffic
deductions"_, and _"It is your responsibility as the publisher to ensure that the traffic on your
ads is valid"_ — including when a third party generates it without permission. Google may
_"suspend or disable the account."_

**The asymmetry: the mint is irreversible, the revenue is not.** A farm drives impressions, the SSV
callbacks fire, coins are minted, features are unlocked and consumed — and days later Google
deducts the revenue. The coin economy has no natural rollback.

Design response, in order:

1. **Cap the exposure, do not try to reverse it.** `coin_daily_earn_cap` × `coin_lifetime_cap`
   bounds what any one account can ever hold. That bound _is_ the clawback ceiling per account.
2. **Do not claw a balance negative.** A user cannot see, contest or have prevented an
   invalid-traffic deduction. Eat the loss. Reversal entries exist in `coin_entries` for
   operator-initiated correction of a _provable_ abuse case, not for routine reconciliation.
3. **Hold back on high-value redemptions.** If a Tier-1 coin economy ever funds statement import,
   put a settlement delay on that specific redemption — a coin minted in the last N hours cannot be
   spent on the most expensive item. Cheap items settle immediately. This costs an honest user
   nothing on the features they actually use hourly and removes the same-day mint-and-burn pattern
   entirely.
4. **Reconcile weekly and detect the repeat offender.** `ad_invalidations` imports finalised AdMob
   revenue by day; a persistent gap between minted coins and finalised revenue is the signal. Score
   accounts by their share of the invalidated period and shadow-limit the worst, rather than
   banning: soft-fail (the earn button says "not available right now"), a documented appeals path,
   and never a balance wipe without a human looking.

### 6.6 Consent is a fraud-adjacent input, and it has a hard edge

**In the EEA, a user who declines consent earns nothing — not less, nothing.** The chain:

1. Non-personalised ads still read the mobile advertising identifier for frequency capping and
   fraud, so ePrivacy Art. 5(3) consent is required for **both** ad types (_secondary_:
   [Google AdSense help](https://support.google.com/adsense/answer/9007336)).
2. **EDPB Guidelines 2/2023** on the technical scope of Art. 5(3), final version **adopted
   2024-10-07**, extend "gaining of access to information already stored in terminal equipment" to
   identifiers embedded in operating systems and mobile app tracking tools — reading the AAID/IDFA
   is itself the consent-triggering act (_secondary_).
3. Google's SDK enforces it mechanically: gate all ad loading on `canRequestAds`; when it is false
   in the EEA the SDK does not serve (_[V]_ for the required call sequence,
   [AdMob iOS privacy](https://developers.google.com/admob/ios/privacy); _[S]_ for the zero-fill
   consequence).

**Product consequence:** the earn path cannot be promised uniformly. Every screen assuming an ad is
obtainable needs an **unavailable** state, not an error state, and the copy must be neutral —
_"Ads aren't available with your current privacy choices"_ — with the privacy-options entry point
right there so the choice is genuinely reversible, and the non-ad path offered in the same view so
it never reads as a dead end. **No re-prompting after a decline, no degraded UI, no framing that
quantifies what they "lost."** Anything punitive is both a "freely given" problem under GDPR and a
dark-pattern problem under the incoming DFA.

**And say plainly what this is:** "decline consent and you lose the earn path" edges toward
consent-or-pay, which is contested. EDPB **Opinion 08/2024** (adopted 2024-04-17) holds that in most
cases large online platforms cannot obtain valid consent from a binary consent-or-pay choice, and
the EDPB's **2026–2027 work programme adopted at its February 2026 plenary includes broader
"Consent or Pay" guidelines** — so the rules that will govern this exact decision are being written
now and do not yet exist. Waves' position is materially better than Meta's (not a large online
platform; the core service is not conditioned on consent; only an _optional bonus currency_ is
affected; and the EDPB's "additional alternative" is satisfiable by the free monthly allowance
this plan already keeps). **That is analysis, not authority. It is a question for counsel, and §10
carries it.**

**Even where ads do serve, consent state moves the price.** Non-personalised inventory pays
**60–80% less** (_secondary_, [RevenueLab, 2026-06-17](https://www.revenuelab.fyi/blog/admob-ecpm-benchmarks-2026)),
and the `TEEN` age treatment lands in the same bucket. Coin grant per ad is therefore a function of
(region × consent state × age band) — or, per §7.2, a single number priced off the floor.

**One coherent consent surface, not two.** UMP governs Google's ad stack **only**; it will not gate
Microsoft Clarity or Sentry, both already in this app. The architecture is one app-level
`ConsentState {ads, analytics, diagnostics, region, ageBand}` with three writers — UMP is
authoritative for `ads` (read `canRequestAds` and `privacyOptionsRequirementStatus`; never infer
analytics consent from a TCF string), the existing Clarity toggle for `analytics`, and Sentry's
own for `diagnostics` — presented in **one privacy screen** alongside UMP's required persistent
privacy-options entry point. CNIL's September 2024 mobile recommendation requires withdrawal to be
as easy as consent; two hidden screens fails that test. **Do not map TCF purposes onto Clarity and
Sentry** — TCF purposes are defined for the ad supply chain and Purpose 8 is not a consent record
for session replay that anybody would recognise. Lazy initialisation is mandatory, not an
optimisation: Clarity must not be _constructed_ before consent is read, which maps onto this repo's
existing lazy-native-require rule. Withdrawal must tear down and clear identifiers, not merely stop
future collection.

**iOS prompt ordering is a state machine, and getting it wrong has caused real App Store
rejections:**

```
EEA / UK / CH, iOS:
  UMP consent form
    declined  -> STOP. No ATT prompt. No ads. Offer the non-ad path.
    consented -> IDFA explainer -> ATT system alert
Rest of world, iOS:
  IDFA explainer (value-exchange pre-prompt) -> ATT system alert
Android:
  No ATT. UMP consent form (EEA) / US-states message (US).
```

ATT opt-in figures disagree wildly across vendors — Adjust ~35% (2025), AppsFlyer ~50% (early
2024), one 2026 aggregator 27% global — and **no finance-vertical benchmark exists**. Use the
range, never a single number.

**US states.** Twenty states now have comprehensive privacy laws; passing an advertising identifier
plus a behavioural signal to an ad network is a "sale"/"share" under CCPA and successors even with
no money changing hands. The app must ship a persistent "Do Not Sell or Share" control that writes
**both** `gad_rdp = 1` into default SharedPreferences **and** the two GPP keys UMP populates
(`IABGPP_GppSID`, `IABGPP_HDR_GppString`) — UMP populates only those two, and **does not** set the
age treatment. Verify the flag is live by proxying the ad request and confirming `&rdp=`; this is
worth a periodic QA step, because it is the only way to prove it. **And note the trap: an expense
app is almost certainly not a GLBA "financial institution", so it gets no GLBA exemption from the
state laws — the burden without the shelter.**

### 6.7 The rest of the threat surface

| #   | Threat                                                     | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                | Residual risk accepted                                                                                                                |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Forged "I watched it" from a modified client               | Client mints nothing. `EARNED_REWARD` is a UI signal. Only `ads-ssv` writes `coin_entries`                                                                                                                                                                                                                                                                                                                                | None material                                                                                                                         |
| 2   | Replayed SSV callback                                      | `transaction_id` PK; mint atomic with the insert; duplicate → 200, no mint                                                                                                                                                                                                                                                                                                                                                | None material                                                                                                                         |
| 3   | Nonce reuse across two views                               | Conditional UPDATE `WHERE state='pending' AND expires_at > now() RETURNING`                                                                                                                                                                                                                                                                                                                                               | None material                                                                                                                         |
| 4   | Crediting another user via forged `user_id`                | `user_id` carries nothing; the credit target is the _stored_ `profile_id` on the nonce row                                                                                                                                                                                                                                                                                                                                | None material                                                                                                                         |
| 5   | Stale/hoarded callback replayed later                      | `timestamp` freshness window (`coin_ssv_max_age_seconds`)                                                                                                                                                                                                                                                                                                                                                                 | Window length is a guess; Google publishes no guidance. §10                                                                           |
| 6   | Key-rotation outage misread as an attack                   | Cache by `key_id`, TTL ≤ 24h, one re-fetch on unknown key, `bad_signature` outcome alerting                                                                                                                                                                                                                                                                                                                               | A rotation during an outage still fails closed — correct, but visible                                                                 |
| 7   | **Invalid-traffic clawback on already-spent coins**        | Bounded by daily × lifetime cap; hold-back on high-value redemptions; weekly reconciliation; no negative balances                                                                                                                                                                                                                                                                                                         | **Accepted.** Bounded, not eliminated. §6.5                                                                                           |
| 8   | Multi-accounting / device farms                            | Reuse `device_sessions` (`device_id`, per-profile unique, feeds `device_cap_free`); nonce carries `device_id`; per-device daily cap beside the per-profile one; guests cannot earn at all (ADR-006 ceilings already limit them to one group and ten days)                                                                                                                                                                 | A determined farmer with real devices and real accounts earns at the honest rate. Bounded by the caps and unprofitable at $0.001/view |
| 9   | Emulators, rooted devices, automation                      | **Play Integrity / App Attest deliberately deferred.** They raise the cost of automation but do not stop a real device running a script, and hard-gating on attestation locks out custom ROMs, some enterprise-managed devices and any attestation outage. If added, it is a _risk-score input_ and a soft-fail. §10                                                                                                      | Accepted. The economics (§7) make automation a poor investment at this reward size                                                    |
| 10  | Geo arbitrage                                              | **Not a threat in the direction assumed.** §7.2                                                                                                                                                                                                                                                                                                                                                                           | n/a                                                                                                                                   |
| 11  | Financial data leaking into the ad request                 | A written, CI-checkable rule: the ad request carries nothing beyond what the SDK gathers itself — **no custom targeting, no keywords, no user or group ids, no amounts, merchants, categories, notes or location**. Note the SDK accepts a `keywords` array, which makes the wrong thing easy. Verified by a periodic proxied traffic capture, and the privacy policy written _from that capture_ rather than from intent | Accepted with monitoring; this is what the FTC and the class-action bar actually prosecute (GoodRx, BetterHelp, Hims & Hers)          |
| 12  | Ads reaching a minor's account with personalised targeting | Store age signal → TFAT `TEEN`; no coin mechanics for teens at all; declare 13+ on Play                                                                                                                                                                                                                                                                                                                                   | Age signal availability varies by store and jurisdiction; neutral age screen is the fallback and users lie to it                      |

---

## 7. Unit economics

**Read this section as a model with wide error bars, not a forecast.** Every input is labelled and
the largest single source of error is stated in §7.7.

### 7.1 Revenue per rewarded impression, by region

Two adjustments have to be applied to every published eCPM before it means anything here.

**The vertical discount.** A shared-expense app will not earn game eCPMs. Playwire (2025-09-17,
_secondary_) states gaming commands 20–30% higher eCPMs than average and is 75% of monetisation
opportunity; RevenueLab (2026-06-17, _secondary_) puts the vertical spread at 4–7× (casino $28–45 US
rewarded vs education/kids $6–11); Tenjin's 2026 benchmark is explicitly a _gaming_ report.
**No publisher reports rewarded eCPM for finance or utility apps.** The **0.5–0.75× multiplier
applied below is an _estimate_, and it is the biggest error term in this model.**

**Fill.** At ~20% tier-1 traffic, single-network fill is 50–70% (_secondary_, Playwire); at ~50%
tier-1, 70–85%; at 80%+ tier-1, 85–95%. RevenueLab adds that single-network AdMob leaves 15–25% of
fill unclaimed versus mediation.

| Region                            | Published rewarded eCPM                          | Source                                                    | ×0.6 vertical (_derived_) | Net per **completed view** | Net per **attempt** after fill |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------------------- | ------------------------- | -------------------------- | ------------------------------ |
| US / CA                           | $14–22 (Tier 1)                                  | RevenueLab 2026-06-17, _secondary_                        | $8.4–13.2                 | $0.0084–0.0132             | ~$0.0076–0.0119 (90% fill)     |
| Western Europe (consented)        | $8–10 (Tier 2) / Europe iOS $8.80, Android $5.10 | RevenueLab; Mistplay citing Appodeal Q4 2024, _secondary_ | $3.1–6.0                  | $0.0031–0.0060             | ~$0.0026–0.0051                |
| Western Europe (consent declined) | —                                                | §6.6                                                      | —                         | **$0.00 — no fill at all** | **$0.00**                      |
| India                             | **no reliable public figure exists**             | see below                                                 | est. $1.2–1.8             | est. $0.0012–0.0018        | **est. $0.00066–0.0010**       |
| SEA (Indonesia)                   | Tier 3 band only; no country figure found        | RevenueLab, _secondary_                                   | est. $1.2–1.8             | est. $0.0012–0.0018        | est. $0.0007–0.0011            |
| LatAm                             | Android $1.90 / iOS $3.75                        | Mistplay/Appodeal Q4 2024, _secondary_                    | $1.1–2.3                  | $0.0011–0.0023             | est. $0.0007–0.0014            |
| MENA — Gulf                       | UAE $14.55 blended; ME iOS $8.40                 | Mistplay/Appodeal, _secondary_                            | $5.0–8.7                  | $0.0050–0.0087             | est. $0.0040–0.0070            |
| MENA — North Africa               | **no figure found**; est. tier-3 band            | _estimate_                                                | est. $0.6–1.8             | est. $0.0006–0.0018        | est. $0.0004–0.0011            |

**India, said plainly: there is no reliable public rewarded eCPM.** The best dataset found
(Appodeal via Mistplay) **omits India and Indonesia entirely**. The $0.80–3.00 band underlying the
row above is triangulated from the APAC Android average ($8.20, itself inflated by
Japan/Korea/Australia), the tier-3 framing ($2–3, "5–20% of a US user"), and the LatAm Android floor
($1.90). **It is an inference, not a source, and it must be replaced by Waves' own AdMob reporting
before it drives any decision.**

Also discarded on verification: a widely repeated claim that India has an 85% rewarded completion
rate against a 63% global average. Fetching the cited source gave ">95%" globally and **no
India-specific figure at all**. It is not in this document.

**MENA is bimodal and the regional average conceals it** — UAE blends to $14.55 while the Middle
East regional *Android* average is $2.30. Gulf states behave like tier 1–2, North Africa like
tier 3. Any per-region logic keyed on "MENA" would be wrong in both directions.

### 7.2 Geo arbitrage runs the other way — and region-priced coins are not implementable anyway

The brief assumed a farmer VPNs into a high-eCPM country and redeems features priced for a
low-eCPM one. **The mechanism is backwards.** _The publisher_ earns the eCPM: a user who appears to
be in the US generates **more** revenue per completed view than one who appears to be in India. On
the revenue line, VPN-ing into a high-eCPM geo is in Waves' favour. There is no arbitrage for the
farmer in that direction.

The genuine exposures are, in order: **invalid-traffic clawback** (§6.5), and **structural loss in
low-eCPM markets** — where a globally-priced coin means a tier-3 user generating $2–3 eCPM earns
the same entitlement as a tier-1 user generating $14–22, a ~7× spread. Given this app's locale
investment (en/ta/hi/ar) that is not a fraud case, it is the **median** case.

**And per-region pricing cannot be cleanly implemented on AdMob anyway: the SSV callback carries no
country and no IP.** (AppLovin MAX exposes `{CC}` and `{IP}`; AdMob does not.) You could pass a
client-asserted region in `custom_data`, but that is attacker-controlled and is precisely the value
a farmer would forge. Geolocating the callback is useless — it originates from Google's servers.

**Therefore: one coin, priced off the tier-3 floor.** Take the lowest plausible net per completed
view (**$0.00066/view**, _derived_) as the anchor. Every other market then produces a surplus rather
than a subsidy, no region logic is needed, no forgeable client assertion is trusted, and nothing has
to be explained to a user as "your ads are worth less". **I agree with this recommendation** and
would additionally note it is the only version that survives the EEA zero-fill case, since a design
with no per-region arithmetic has nothing to get wrong when a whole region's fill goes to zero.

### 7.3 Cost per redemption — voice

| Component   | Vendor / model                      | Price                                      | Per 10s utterance          |
| ----------- | ----------------------------------- | ------------------------------------------ | -------------------------- |
| STT         | AssemblyAI Universal-2 async        | $0.15/hr (_list_)                          | **$0.0000417** (_derived_) |
| STT         | Deepgram Nova-3 mono batch          | $0.0043/min (_list_)                       | $0.0000717 (_derived_)     |
| STT         | Groq `whisper-large-v3-turbo`       | $0.04/hr, **10s minimum billing** (_list_) | $0.000111 (the floor)      |
| STT         | OpenAI `gpt-4o-mini-transcribe`     | $0.003/min (_list_)                        | $0.0005                    |
| STT         | Google STT V2 standard              | ~$0.016/min — **secondary, see caveat**    | $0.00267                   |
| Structuring | OpenAI GPT-5 nano, 500 in / 200 out | $0.05 / $0.40 per M (_list_)               | **$0.000105** (_derived_)  |
| Structuring | Gemini 2.5 Flash-Lite               | $0.10 / $0.40 per M (_list_)               | $0.00013                   |
| Structuring | Claude Haiku 4.5                    | $1.00 / $5.00 per M (_list_)               | $0.0015 (batch $0.00075)   |

> **Google Speech-to-Text caveat, preserved deliberately.** `cloud.google.com/speech-to-text/pricing`
> would not render its pricing table across four fetch attempts and the V2 path 404s. The Google
> STT figures above are from a **secondary** source
> ([ConvertAudioToText, published 2026-02-23, updated 2026-07-01](https://convertaudiototext.com/blog/google-cloud-speech-to-text-pricing-2026)),
> corroborated by other 2026 write-ups but **not by Google**. They are the only STT numbers here not
> read off the vendor's own page. **Verify live before any of them enter a cost model.**

**Cheap stack total: $0.00015–$0.00017 per voice expense** (_derived_). The A48 design assumed
Deepgram first with a per-minute meter; that assumption still holds and costs about $0.00016 with
GPT-5 nano structuring.

**Three traps.** Groq bills a **10-second minimum per request**, so short utterances never get
cheaper there — for 3–5s utterances Groq becomes the _most_ expensive of the three, while
Deepgram and AssemblyAI bill per second and genuinely halve. Deepgram's cheap streaming rates are
**promotional with no published end date** ($0.0048/min promo against a regular $0.0077/min printed
on the same page). Gemini 3.8 Flash **doubles on 2027-01-01** ($0.75→$1.50 in, $3.75→$7.50 out,
stated on Google's own page). **Price against regular rates, not promos.**

**The one thing that would break the conclusion: making voice conversational.** One-shot
transcribe-then-structure is $0.00015. A realtime clarification dialogue is a different product —
`gpt-realtime-2.1` audio input at $32/M tokens works out at roughly **$0.0032 per 10 seconds**
(_derived_, assuming ~10 audio tokens/sec, **an unverified assumption**), 20–100× the one-shot cost.
Keep voice single-shot and the number holds.

### 7.4 Cost per redemption — receipt OCR (the cloud tier only; on-device is free)

| Route                                                                                      | Per receipt                        | Source                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gemini 2.5 Flash-Lite VLM** (1000×1000 image → 1,032 tokens + ~200 prompt + ~250 output) | **~$0.00022**                      | _derived_ from _list_ token prices and Gemini's published tiling rule                                                                       |
| **Claude Haiku 4.5 VLM** (1,296 visual tokens by the `⌈w/28⌉×⌈h/28⌉` rule)                 | **~$0.0027**                       | _derived_; Anthropic's own docs give an independent anchor of _"about $1.30 per thousand images"_ for 1000×1000 on Haiku 4.5, which matches |
| AWS Textract `DetectDocumentText`                                                          | $0.0015/page                       | _list_                                                                                                                                      |
| AWS Textract `AnalyzeExpense`                                                              | $0.01/page                         | _list_                                                                                                                                      |
| Google Doc AI Expense Parser                                                               | $0.01/page                         | **secondary** — page would not render                                                                                                       |
| Azure Document Intelligence prebuilt Receipt                                               | ~$0.01/page, 500 free/month        | **secondary** for the rate; the free tier _is_ list                                                                                         |
| Taggun                                                                                     | $0.056/scan, **$28/mo minimum**    | _list_                                                                                                                                      |
| Veryfi                                                                                     | $0.08/receipt, **$500/mo minimum** | _list_                                                                                                                                      |
| Mindee                                                                                     | ~$0.044/credit, $44–116/mo minimum | _list_                                                                                                                                      |
| Klippa                                                                                     | **no public pricing** (page 404s)  | not established                                                                                                                             |

**A VLM reading a receipt is ~45× cheaper than Textract AnalyzeExpense and ~360× cheaper than
Veryfi.** What the specialists sell is not lower cost — it is a stable schema, per-field confidence
scores and a contractual counterparty. **That difference matters more here than the price does:** a
VLM that hallucinates a line item returns confident, well-formed, wrong JSON, and in this app a
wrong line item becomes a wrong balance between two friends, which is the worst failure the product
has. ADR-008's existing answer — validate that items + taxes reconcile to the printed total and flag
low-confidence lines for correction — is the right defence and already built (`checkReceipt` in
`@waves/core`).

**For the coin economy:** at $0.00022 a cloud receipt is not a cost sink either. It becomes gateable
only by deliberately choosing a specialist — and Veryfi's $500/month minimum makes that a **fixed**
cost, which is the wrong shape for a per-use currency entirely.

### 7.5 Cost per redemption — bank statement, and the spread that decides everything

**20-page statement, ~300 transactions (~9,000 output tokens), pages at ~1700×2200 px:**

| Route                               | Per statement                                                              | Source                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Gemini 2.5 Flash-Lite**           | **~$0.0057**                                                               | _derived_ from _list_ prices + published tiling                                         |
| Gemini 3.8 Flash                    | ~$0.050 (→ ~$0.10 after 2027-01-01)                                        | _derived_                                                                               |
| Claude Haiku 4.5                    | ~$0.077                                                                    | _derived_                                                                               |
| Claude Sonnet 5                     | ~$0.154                                                                    | _derived_                                                                               |
| Azure prebuilt                      | ~$0.20                                                                     | _derived_ from a **secondary** per-page rate                                            |
| AWS Textract AnalyzeDocument Tables | $0.30                                                                      | _derived_ from _list_                                                                   |
| Google Doc AI Custom Extractor      | $0.60                                                                      | _derived_ from a **secondary** rate                                                     |
| Fintract                            | $1.00                                                                      | vendor's own site, but it is a competitor publishing rivals' prices — read as marketing |
| **Ocrolus / Inscribe**              | **$10 – $40**                                                              | **estimate** — converging analyst/reseller reports; neither publishes a price           |
| Plaid Statements / Assets           | **not publicly priced**; free Trial plan capped at **10 Production Items** | _list_ (the absence is confirmed)                                                       |

**That is a ~6,000× spread, and choosing between its ends decides whether the feature is viable at
all.**

**Two multipliers on the LLM figures.** Input scales with pages; **output scales with transaction
count and dominates** — on Haiku a 20-page statement is 74% output cost. And a single 30k-token call
over 20 dense pages is exactly where a model silently drops rows from the middle, so the feature
actually needs **per-page chunked extraction with balance-continuity reconciliation** (opening
balance + transactions = closing balance, per page and per statement). **Budget 2–3× the naive
number**, and treat a statement that fails reconciliation as needing a retry or a human. That is
precisely what the $0.50–$2.00/page vendors sell: tamper detection, balance continuity, and an
audit trail. The 100–1000× gap is not free money.

**Working figure for the rest of this section: $0.014 per 20-page statement** (Gemini Flash-Lite,
2.5× pipeline multiplier) at the cheap end, **$0.19** (Claude Haiku, same multiplier) at the mid,
**$10** at the specialist end.

### 7.6 The arithmetic: how many ads buy each thing

Net per completed view, from §7.1: **India $0.00066–0.0010**, **US $0.0076–0.0119**.

| Feature                                | Cost per use | Ads to fund it — **India**           | Ads — **US**           |
| -------------------------------------- | ------------ | ------------------------------------ | ---------------------- |
| Cloud voice expense (cheap stack)      | $0.00015     | **0.15–0.23** — one ad funds **4–7** | one ad funds **50–80** |
| Cloud voice expense (Deepgram + Haiku) | $0.0016      | 1.6–2.4                              | 0.13–0.21              |
| Cloud receipt, Gemini Flash-Lite VLM   | $0.00022     | **0.22–0.33** — one ad funds **3–5** | one ad funds **35–54** |
| Cloud receipt, Claude Haiku VLM        | $0.0027      | 2.7–4.1                              | 0.23–0.36              |
| Cloud receipt, Textract AnalyzeExpense | $0.01        | **10–15**                            | 0.8–1.3                |
| Statement 20pp, Flash-Lite + pipeline  | $0.014       | **14–21**                            | 1.2–1.8                |
| Statement 20pp, Haiku + pipeline       | $0.19        | **190–290**                          | 16–25                  |
| Statement 20pp, Ocrolus/Inscribe       | $10          | **10,000–15,000**                    | 840–1,300              |

**Reading it.** With a daily earn cap of 3, an Indian user can fund **twenty voice expenses or
twelve cloud receipts a day** on the cheap stack — which is far more than anyone uses, which is the
point: **the meter would never bind, so the meter is theatre.** The same user needs **five to seven
days of maxed-out ad watching** to fund one statement import on the cheapest possible stack, and
**two to three months** on a mid stack. A US user funds a cheap-stack statement in one or two ads
and a mid-stack one in six to nine days.

**Where the model goes negative, and the levers:**

| Condition                                      | Effect                                        | Lever                                                                                   |
| ---------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| A globally flat coin priced for tier 1         | Loss-making in the median market              | **Price off the tier-3 floor** (§7.2). Single largest fix                               |
| Statement import on a mid or specialist vendor | Negative in every market at any plausible cap | Make it **paid, not earned**; or on-device extraction; or cheapest-VLM + reconciliation |
| EEA consent declined                           | Revenue $0 while cost is unchanged            | Non-ad path must exist (free allowance / subscription). Never a coin-only feature       |
| Non-personalised / TEEN inventory              | 60–80% eCPM haircut (_secondary_)             | Already absorbed by pricing off the floor                                               |
| Fill at ~50% in tier-3                         | Halves effective revenue                      | Already in the "per attempt" column; mediation is the lever, at ~50K DAU, not now       |
| Voice made conversational                      | 20–100× cost                                  | Keep it single-shot                                                                     |

### 7.7 Compared with just charging — the number that decides it

ADR-011 rule (3) sets regional pricing at local purchasing power, India ~₹49–99/mo. Take ₹79/mo
≈ **$0.95**, less a 15% store commission ≈ **$0.80/month net**, ≈ **$9.60/year**. US, using the
Splitwise *estimate* of $4.99/mo as the category anchor, ≈ **$4.24/month net**, ≈ **$50/year**.

**Ad revenue per DAU** at 0.1–0.5 rewarded impressions/DAU (_estimate_):

|                     | Per DAU/day      | Per DAU/year    |
| ------------------- | ---------------- | --------------- |
| India, $0.0008/view | $0.00008–$0.0004 | **$0.03–$0.15** |
| US, $0.010/view     | $0.001–$0.005    | **$0.37–$1.83** |

**So a rewarded ad programme is worth about 1% of a subscription in India and about 2–4% in the
US.** That is the whole answer to "is this a business model": it is not. **It is a demo budget** —
the mechanism by which a free user experiences the AI feature and then decides to pay. Budget it as
customer acquisition and it is cheap and sensible. Budget it as revenue and it will disappoint by
two orders of magnitude.

**And the crossover the brief asked for — at what usage does a free user cost more than a
subscriber pays?** Against $0.80/month net from an Indian subscriber:

| Free-user activity                           | Break-even volume per month                                     |
| -------------------------------------------- | --------------------------------------------------------------- |
| Cloud voice expenses (cheap stack, $0.00015) | **~5,300**                                                      |
| Cloud receipts (Flash-Lite VLM, $0.00022)    | **~3,600**                                                      |
| Statements (Flash-Lite + pipeline, $0.014)   | **~57**                                                         |
| Statements (Haiku + pipeline, $0.19)         | **~4**                                                          |
| Statements (Ocrolus, $10)                    | **0.08 — one import costs 12.5 months of subscription revenue** |

**That last row is the decision.** On a specialist statement vendor, a single free-tier import from
one Indian user costs more than that user would pay in a year. Voice and cloud OCR cannot be made
expensive enough to matter at any realistic usage. **The coin economy has exactly one thing worth
gating, and that thing is too expensive to give away for ads in the markets Waves is built for.**

**Finally, the prerequisite for trusting any of this: write `usage_events.cost_minor`.** Every
figure above is a list price, and list prices move. The repo already has the column, the aggregation
(`waves_admin_ai_cost`) and the dashboard cell; only the write is missing. Once every vendor call
records its own cost in minor units, the coin price becomes a function of _observed_ COGS and the
model in this section becomes a starting point rather than a standing assumption.

---

## 8. Bank-statement import

**This is the highest-risk item in the request and the plan says so up front.** It is financial PII
of the user _and_ of every third party named in their statement — landlords, employers, doctors,
charities, other Waves users — none of whom consented to anything.

### 8.1 What a statement actually contains

The EDPB is explicit that financial transactions _"can sometimes reveal special categories of
personal data"_ — political opinion and religious belief from donations, trade union membership from
a deducted fee, health data from paid medical bills
([Guidelines 06/2020 on the interplay of PSD2 and the GDPR](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202006_psd2_afterpublicconsultation_en.pdf)).
**Article 9 processing is prohibited absent explicit consent**, and a bank statement is one of the
most Article-9-dense documents a consumer owns. The EDPB advises a **DPIA**. Escaping the licensing
perimeter (§8.3) does not escape this.

### 8.2 Recommended approach: on-device parsing, phase one

**Recommendation: parse the statement on the device and never upload it.** Reasons, in order:

1. **The repo already argues this position.** `packages/core/src/sms/parse.ts` exists precisely
   because _"A bank SMS carries an account tail, a balance, and sometimes a one-time password;
   sending it anywhere to be parsed would be a worse privacy trade than the feature is worth."_ A
   statement is that argument multiplied by three hundred rows.
2. **It removes the entire zero-data-retention problem.** §8.4 shows every cheap inference path
   defaults to retention and every ZDR route is sales-gated. On-device sends nothing.
3. **It removes the storage, retention, deletion and staff-access questions in one move.** There is
   nothing to retain.
4. **The machinery exists.** ML Kit text recognition is already a dependency and already reads
   bills; `expo-document-picker` is already there; `packages/core/src/sms/parse.ts` is the working
   pattern for turning bank text into `Money` in minor units with no float (ADR-003); the output
   maps one-to-one onto `PersonalTxn`, which already rides the `personalScope` queue.
5. **It fits the guarantee already made.** A proposed transaction is a **candidate**, never an
   entry — `proposeFromSms` returns candidates and a person confirms each one. A statement import
   is the same shape with a review screen in front of the ledger.

**Where an on-device-only phase one is weakest:** PDF layout variety across thousands of banks and
languages, scanned/image statements, and password-protected PDFs. That weakness is the honest
argument for a cloud tier — but it is a _phase two_ argument, gated on §8.4, not a reason to send
bytes on day one.

**If a cloud tier is built, the non-negotiables:** it reuses the party-only attachment posture
(`docs/private-attachments.md`) — the bytes brokered **by subject, not by path**, a **60-second**
presign because R2 presigns cannot be revoked, **no service-role dual-read fallback**, and an
unguessable UUID path; the object is deleted immediately on parse completion with a `storage_orphans`
sweep as the backstop (this already exists); the derived transactions are stored, the document is
not; retention is stated in the UI in the same sentence as the upload button; and nothing about the
statement ever reaches an analytics or ad SDK. **The tax-prep pixel scandal is the read-across
here** — H&R Block, TaxAct and TaxSlayer transmitted taxpayer names, income and refund amounts to
Meta via the pixel, some going back to 2011, some without the firms understanding what was leaking
([The Markup, July 2023](https://themarkup.org/pixel-hunt/2023/07/12/congressional-report-finds-meta-and-tax-prep-companies-recklessly-shared-taxpayers-data)).
**Your analytics SDK is a more likely leak path than your OCR vendor.**

### 8.3 Aggregator API versus user-supplied document — and the per-market verdict

**No market researched requires a licensed aggregator to parse a document the user uploads.** The
licence — AISP in the EU/UK, NBFC-AA in India, the CFPB §1033 authorised-third-party regime in the
US — attaches to **programmatic access to the account**, not to the sensitivity of the data. The
FCA states the test cleanly: _"Whether a service is an account information service depends on
whether there has been access to payment accounts"_
([PERG 15.3 Q25A](https://handbook.fca.org.uk/handbook/PERG/15/3.html), _quoted_). Screen-scraping
with the user's credentials **is** inside the perimeter; a PDF the user exported from their own bank
is not.

**Stated as a limitation:** that is a reading of the perimeter test. **No EBA Q&A or FCA passage
addressing document upload specifically was found** — it was searched for. Counsel must confirm
before this appears as settled anywhere user-facing.

| Market         | Verdict                                                                   | What it turns on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EU / EEA**   | **Safe to launch, with conditions**                                       | Outside the PSD2/AISP perimeter. GDPR is the binding constraint: Article 9 special categories per EDPB 06/2020. **DPIA before launch; explicit consent.** PSD3/PSR (provisional agreement 2025-11-27, OJ expected mid-2026, general application targeted Q2/Q3 2028) and FiDA are pre-adoption and change nothing before ~2028                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **UK**         | **Safe to launch**                                                        | Same analysis; PERG 15.3 is the clearest authority anywhere. The Data (Use and Access) Act 2025 smart-data framework does not reach document upload; first open-banking SI expected Q4 2026                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **India**      | **Safe to launch, with a dated deadline**                                 | No NBFC-AA licence needed — an NBFC-AA needs ₹2 crore net owned fund and **cannot conduct any other business**, so being one is structurally impossible for a consumer app. Market practice settles it: only ~38% of Indian borrower accounts were AA-enabled as of Dec 2025, so **62% of borrowers still go through PDF analysis** and hybrid AA+PDF is standard regulated-lender practice. **DPDP Rules 2025 notified 2025-11-13; all substantive obligations commence 2027-05-13.** Design for it now                                                                                                                                                                                                                                                                                                                                                  |
| **US**         | **Needs a decision, not a licence**                                       | §1033 is **enjoined, not vacated** (E.D. Ky. preliminary injunction; CFPB reversed position and told the court its own rule was unlawful; ANPRM Aug 2025; a reconsideration NPRM went to OIRA Aug 2026). The real issue is **GLBA**: a 2018 Treasury report took the view that data aggregators and consumer fintech application providers are financial institutions subject to GLBA, and **adding statement import is the step that makes "significantly engaged in financial activities" hard to argue against**. If GLBA applies, so does the **FTC Safeguards Rule** — written security programme, named qualified individual, risk assessment, encryption, MFA, vendor oversight, incident response. California's SB 1 is stricter than federal GLBA: **explicit opt-in** to share nonpublic personal information with non-affiliated third parties |
| **Everywhere** | **Exclude at first: sending a statement to any LLM without ZDR in place** | §8.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Recommended launch set for phase one: EU, UK, India — on-device only.** Add the US when either
(a) a Safeguards-compliant programme exists, or (b) bank data is routed through a licensed
aggregator that already has one.

### 8.4 The zero-data-retention gate — a phase gate, not a footnote

| Vendor                        | Default retention                                        | ZDR available?                    | What must be in place                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AWS Bedrock**               | **Zero retention _and_ zero operator access by default** | **Default**                       | **Nothing.** The only self-serve zero-retention path found. Named exceptions: Anthropic Fable 5/5.1 (all traffic retained 30 days, flagged traffic subject to AWS human review) and OpenAI GPT-5.x (classifier-flagged traffic retained 30 days) |
| Anthropic (Claude API)        | Deleted within 30 days                                   | Yes                               | Commercial agreement + sales request, **enabled per organisation**. CORS unsupported under ZDR                                                                                                                                                   |
| OpenAI                        | Abuse logs up to 30 days                                 | Yes                               | _"Subject to prior approval by OpenAI and acceptance of additional requirements"_ — sales gate. Assistants/Conversations/Threads/Vector-stores/Videos remain ineligible                                                                          |
| Google Vertex AI              | Gemini inputs cached up to 24h by default                | ZDR-equivalent                    | **Contractual amendment to the DPA** via the account team, plus a separate abuse-monitoring exception                                                                                                                                            |
| **Azure / Microsoft Foundry** | Up to 30 days for abuse monitoring + human review        | Yes ("modified abuse monitoring") | **HARD GATE: Enterprise Agreement or Microsoft Customer Agreement only — not available on Pay-As-You-Go**                                                                                                                                        |

**The collision:** the cheapest inference path — self-serve Gemini Flash-Lite or Claude Haiku, the
two models §7.5 would otherwise pick — is precisely the path with **no ZDR**. Three escapes:
**Bedrock's default-ZDR posture** (avoiding the named models), **on-device extraction** (sends
nothing at all), or **send a redacted derivative** — parse on device and let only categorised
totals leave, so the model never sees an Article-9-dense document.

**Make this an explicit gate in the phase plan: the cloud statement tier cannot ship until a vendor
with acceptable retention terms is reachable at Waves' contracting level.** Today that means
Bedrock or nothing.

### 8.5 What could go wrong, named

- **A silently wrong extraction corrupts the ledger.** A model that drops rows from the middle of a
  dense statement produces a plausible, confident, incomplete import. Mitigation: per-page chunking
  with **balance-continuity reconciliation** as a hard gate (opening + transactions = closing, per
  page and per statement), a review screen that shows what did not reconcile, and — following the
  SMS precedent — **candidates, never entries**. The personal ledger is private, so a wrong row
  here does not move a shared balance; that is the one mercy in this feature and it is why it
  belongs in `personal_records` and nowhere else.
- **A statement retained longer than promised.** Mitigation: delete on parse completion, the
  existing `storage_orphans` sweep as backstop, retention stated in the same sentence as the upload
  button, and an operational check that the sweep actually ran.
- **A vendor's retention terms turn out to be different from what was assumed.** §8.4 is the gate.
- **Human eyes on the document.** The Expensify/Mechanical Turk incident (November 2017) is the
  closest analogue and the one to put in front of anybody proposing a human-in-the-loop tier: a Turk
  worker publicly posted that she could see a customer's Uber receipt with full name and address;
  other exposed documents included a hotel invoice with the guest's name, **bank account number**
  and itemised expenses. Workers were paid ~2 cents per receipt
  ([Quartz](https://qz.com/1141695/startup-expensifys-smart-scanning-technology-used-humans-hired-on-amazon-mechanical-turk)).
  **No human-in-the-loop tier, ever.**
- **Over-collection is independently actionable even where access was authorised.** Plaid's $58M
  class settlement (2021) required deleting transactional data for apps that had not requested it
  and storing only what was necessary absent express consent. Extract what the user asked for and
  discard the rest.
- **I found no incident of a consumer expense-splitting app leaking uploaded statements.** Read that
  as a thin evidence base in a young category, not a safe harbour.

---

## 9. Ads-free for paying users

**Rule: a paying user must never see an ad, and must never see an earn affordance either.** Apple
3.1.1 is the policy basis (_quoted_): subscribers _"should allow a user to get what they've paid for
without performing additional tasks, such as posting on social media, uploading contacts, checking
in to the app a certain number of times."_ Offering a paying user a "watch an ad" button is exactly
that shape.

**Entitlement is per person, not per group.** Use `waves_profile_is_paid`, not
`waves_group_is_paid`. This matches the A48 rule for cloud voice — _"A free user in a group with a
paid member is still metered"_ — and it is the right call for a second reason: ad-free is a property
of the _device in front of a human_, and a groupmate's subscription cannot make an advert not
appear on somebody else's phone.

**The cold-start trap, and how to close it.** Three states, never two:

```
unknown | entitled | free
```

- **Never render an ad, an earn button, or an ad SDK initialisation in `unknown`.** Fail toward the
  user. A free user seeing no ad costs one impression — a fraction of a cent by §7.1. A paying user
  seeing an ad costs a refund and a review that outlives the impression by years. The expected
  values are not close.
- **Persist last-known entitlement locally and trust it on launch.** This app is offline-first
  (ADR-005): an entitlement check requiring a network round trip resolves to `unknown` _regularly_,
  not rarely. RevenueCat's published pattern — a `loading`-gated hook over `getCustomerInfo()` —
  does not address offline at all, and that gap is exactly where this app lives.
- **The cache must be readable before the ad SDK is constructed**, and therefore **must not require
  the encrypted mirror to be unlocked first.** It belongs wherever settings already survive a cold
  start, not in `mirror_rows`. This is a real constraint in this codebase, not a hypothetical: the
  mirror's `json` columns are sealed with a keystore-derived key and a row the key will not open is
  quarantined rather than deleted.
- **Session-scoped override after any purchase or restore.** There is an indeterminate gap between
  a successful purchase and the server-side entitlement being refreshed; a
  `hasSubscribedSinceLaunch` flag set on success and honoured for the life of the launch closes it.
- **An empty entitlement object is indistinguishable from "not yet loaded"** unless loading is
  tracked separately. Track it separately.

**Where an ad may never appear at all, regardless of entitlement:** the three launcher widgets, the
Apple Watch and Wear OS companions (Apple 2.5.18 names widgets and watchOS explicitly), and — from
ADR-011 rule (4), _"No third-party ads in any money flow"_ — **any screen where money is on the
scene**: add-expense, split, settle-up, balances, the group ledger, the activity feed, Friends. The
earn entry point lives on the AI-feature surfaces and on a dedicated coins screen, and nowhere else.

**Rewarded interstitial is the wrong format and must not be used**, even though it exists and
supports SSV identically. It is still marked beta, and _"unlike rewarded ads, users aren't required
to opt in"_ (_quoted_) — it fires on app transitions, which in this app means it could appear
between tapping "settle up" and seeing the result. It also forfeits the Play policy carve-out that
lets an opted-in rewarded ad run its full length (_quoted_: _"This policy does not apply to rewarded
ads which are explicitly opted-in by users"_). **Opt-in rewarded only.**

---

## 10. Phased delivery

Each phase names what "done" means and what it depends on. Phases 0–2 are the recommended scope;
3–5 are conditional on their gates.

### Phase 0 — Prove the SDK builds (do this before anything else)

**Done when:** a rewarded test ad (`TestIds.REWARDED`) loads and completes on a real Android device
and a real iOS device, from a local `gradlew` build of this repo at Expo `~57.0.18` / RN `0.86.3`,
with the UMP consent form presenting.
**Why first:** full-screen ads and UMP are the least-complete parts of `react-native-google-mobile-ads`
on the New Architecture; Expo SDK 55+ requires New Architecture; issue #835 reports the config plugin
failing to load on SDK 54 and is closed as not planned with no fix version. **If this phase fails,
the whole plan stops here** and the answer to the user is "not on this stack yet".
**Depends on:** an AdMob account and one test ad unit. Nothing else.
**Cost if it fails:** two days.

### Phase 1 — The purchase (the actual blocker)

**Done when:** a user can buy a subscription on both stores, `subscriptions` receives a row with a
unique `store_txn_id`, `waves_profile_is_paid` returns true, and `settings/upgrade.tsx` and
`paywall.tsx` are reconciled into one truthful screen with regional prices per ADR-011 rule (3) and
full i18n (en/ta/hi/ar + RTL).
**Why before ads:** shipping ads first leaves free users with no escape, which is both bad product
and the wrong order under Apple 3.1.1.
**Depends on:** store products created in both consoles; a purchase SDK decision (native, not OTA).

### Phase 2 — Consent, entitlement and the ad, with no currency

**Done when:**

- One `ConsentState` with UMP authoritative for `ads`, the existing Clarity toggle for `analytics`,
  Sentry for `diagnostics`, all in one privacy screen with UMP's persistent privacy-options entry
  point; lazy initialisation for Clarity; teardown on withdrawal.
- The iOS prompt-ordering state machine (§6.6) implemented and verified on device, including the
  "declined GDPR → never prompt ATT" branch.
- `PrivacyInfo.xcprivacy` emitted by the config plugin covering Mobile Ads and UMP.
- `gad_rdp` + GPP keys written by an in-app "Do Not Sell or Share" control, **verified by a proxied
  ad-request capture showing `&rdp=`**.
- TFAT set from the store age signal, `TEEN` where indicated, with a neutral age screen fallback.
- The three-state entitlement (`unknown | entitled | free`) with local persistence readable before
  the ad SDK is constructed; no ad or earn affordance in `unknown`.
- `ads-nonce` + `ads-ssv` deployed; `verify_jwt = false` for `ads-ssv` in `config.toml`; the raw-query
  signature verification with a **fixture test built from a captured real callback**;
  `transaction_id` PK dedup; nonce single-use; freshness window.
- `coin_entries` exists with `coin_per_ad = 1` and one price of 1 — i.e. **one ad, one unlock**, no
  currency surfaced.
- `usage_events.cost_minor` written by every vendor call.
- The pre-launch risk-assessment note written (§2.4).
- Ships dark behind `feature_flags:ads_enabled`.

**Depends on:** Phase 0 and Phase 1; an AdMob production ad unit per platform with the SSV callback
URL configured; the CMP decision (UMP recommended — free, Google-certified, covers TCF and GPP).

### Phase 3 — Finish A48 (cloud voice) as a _free_ allowance

**Done when:** `voice-stt` and `voice-structure` exist, metered against the already-shipped
`voice_stt_usage` / `voice_stt_free_seconds`, with the on-device fallback intact; cloud voice is
**free within the allowance** and unmetered for paid users; no coin is involved.
**Why here:** §7.6 shows one ad funds 4–7 voice expenses even in India. The allowance is the right
instrument and it is already built.
**Depends on:** an STT provider key and an LLM key in edge env. **Gate:** a per-minute rate limit on
`voice-stt` in addition to the monthly quota.

### Phase 4 — Coins, only if the gate opens

**Gate — do not start unless all three hold:**

1. There are **≥3 spendable things of genuinely different cost** (candidates: statement import,
   extra receipts beyond `receipt_cap_per_group`, storage beyond `free_storage_cap_bytes`,
   attachments beyond `attachment_cap_per_expense`).
2. Observed `usage_events.cost_minor` and observed AdMob revenue — not the estimates in §7 —
   confirm the ratio.
3. The user-facing coin surface can carry the real-money equivalent on every price.

**Done when:** balance, per-lot expiry dates, FIFO consumption, the daily/lifetime caps as
`app_config` knobs with A/B arms, `waves_coin_expire_due` on `pg_cron`, `waves_admin_coin_economy`,
weekly `ad_invalidations` reconciliation, and the clawback hold-back on the most expensive
redemption.

### Phase 5 — Statement import

**5a — on-device, EU/UK/India only.** Extend `packages/core/src/sms/parse.ts`'s approach to
statement text; `expo-document-picker` for the file; ML Kit for scanned pages; balance-continuity
reconciliation as a hard gate; a review screen; output as `personal.upsert` candidates on the
existing personal scope. **Nothing leaves the device.**
**Gates:** DPIA written and signed off (EU); DPDP compliance plan for 2027-05-13 (India); a stated
retention position; counsel's confirmation of the PSD2/AISP perimeter reading.

**5b — cloud tier, conditional.** Only if 5a's accuracy is insufficient _and_ a vendor with
acceptable retention terms is reachable at Waves' contracting level (§8.4 — today that means AWS
Bedrock, avoiding the named models, or nothing). Party-only storage posture, 60-second presigns,
delete on completion.
**Gates:** the ZDR gate above; a US decision (GLBA Safeguards programme, or exclude the US, or
route through a licensed aggregator); pricing decision — §7.7 says at mid or specialist vendor cost
this is a **paid** feature, not an earned one.

**Spec amendments owed, and this repo records deviations rather than hiding them:**

| Document    | Amendment                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-011** | Addendum: rule (1)'s "no interstitial ads, ever" stands — a user-initiated rewarded video is not an interstitial and none is ever shown unprompted. Rule (4)'s "no third-party ads in any money flow" is **narrowed explicitly**: ads live on the AI-feature surfaces and a coins screen, never on add-expense, split, settle, balances, the ledger, activity or Friends. Rule (2) gains "attention" as a second currency for the same convenience features |
| **ADR-013** | Addendum: `ads-ssv` is an unauthenticated edge function whose trust root is an ECDSA signature over the raw query string, the third instance of the `email-events` pattern                                                                                                                                                                                                                                                                                  |
| **ADR-005** | Addendum: a coin mint has no mutation kind and cannot be queued; a coin spend is refused rather than queued, because an optimistic debit renders a balance the user does not have                                                                                                                                                                                                                                                                           |
| **ADR-006** | Addendum: a guest (anonymous session) cannot earn. The existing one-group / ten-day ceilings already bound them; an unclaimed account is the ideal multi-accounting vector                                                                                                                                                                                                                                                                                  |
| **ADR-008** | Note: the cloud OCR tier stays free within `waves_receipt_scan_quota`; coins do not buy scans                                                                                                                                                                                                                                                                                                                                                               |
| **TDR §12** | New amendment **A65**, plus the A48 open questions in `docs/voice-cloud-stt-and-structuring.md` §9 answered (managed-LLM entitlement, whose key pays, audio retention)                                                                                                                                                                                                                                                                                      |

---

## 11. Open questions, and what the user must obtain

### 11.1 Decisions only the user can make

1. **Is the purchase path being built?** Everything else depends on it. Which SDK, which stores,
   which regional price ladder.
2. **Does the coin economy survive §7?** My recommendation is one-ad-one-unlock now, coins later or
   never. If coins are wanted regardless, say so and Phase 4 becomes unconditional — but the doc
   should record that it was a product decision, not an economic one.
3. **Statement import: paid or earned?** §7.7 says paid at anything above the cheapest possible
   stack.
4. **Which markets launch statement import?** Recommended: EU, UK, India on-device. The US needs a
   GLBA decision.
5. **Is a guest allowed to earn?** Recommended no.
6. **Will coins ever be sold?** If yes, separate ledgers from day one; the earned pot must never
   inherit Apple's no-expiry rule.
7. **Play's "financial features" declaration** — since 2023-08-31 every release must answer whether
   the app includes financial features. **Whether a shared-expense app must declare is genuinely
   ambiguous** on the published text (Play defines them as "related to the management or investment
   of money"; enforcement examples are loans, investments, crypto). Read the Console form's own
   category list rather than guessing. Unrelated to ads, but live either way.

### 11.2 Accounts, contracts and approvals to obtain

| What                                                                                | For            | Notes                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google AdMob account** + one app per platform + one rewarded ad unit per platform | Phase 0 and 2  | The SSV callback URL is configured **per ad unit in the console**, not in code                                                                                                                                                                                                                                                                                                   |
| **A Google-certified CMP**                                                          | Phase 2        | UMP recommended: free, Google's own, covers both TCF (EEA) and GPP (US). Pin to a version emitting **TCF v2.3** strings — since 2026-03-01 every newly created TC String must carry the `disclosedVendors` segment and Google no longer supports newly created v2.2 strings. Also: TCF requires re-prompting at least every 13 months or the string is invalid and serving stops |
| **App Store Connect + Play Console products**                                       | Phase 1        | Regional price ladder per ADR-011 rule (3)                                                                                                                                                                                                                                                                                                                                       |
| **Play target-audience declaration set to 13+**                                     | Phase 2        | Do **not** enter Families: rewarded ads there must be closeable after 5 seconds, which breaks the mechanic, and the Families Self-Certified Ads SDK Program is not accepting new applicants                                                                                                                                                                                      |
| **STT + LLM provider keys in edge env**                                             | Phase 3        | Per TDR §11, secrets only in edge-function env; the bundle stays keyless                                                                                                                                                                                                                                                                                                         |
| **A vendor with acceptable retention terms for statements**                         | Phase 5b       | AWS Bedrock is the only self-serve zero-retention path found. Anthropic/OpenAI/Vertex are sales-gated; **Azure requires an EA/MCA and is unavailable on pay-as-you-go**                                                                                                                                                                                                          |
| **Legal review**                                                                    | Phases 2 and 5 | Three specific questions: the consent-or-pay reading in §6.6; the PSD2/AISP perimeter reading in §8.3; and whether Waves is a GLBA "financial institution" once it ingests statements                                                                                                                                                                                            |
| **DPIA**                                                                            | Phase 5a       | EDPB advises one for financial-transaction processing; required before EU launch                                                                                                                                                                                                                                                                                                 |

### 11.3 What could not be established

Recorded so nothing here is mistaken for a gap in the writing rather than a gap in the evidence.
Consolidated from all four research strands.

**Economics and ads**

1. **Rewarded eCPM for finance or utility apps.** No publisher reports it. The 0.5–0.75× vertical
   multiplier used throughout §7 is an inference and is the largest error term in the model.
2. **India-specific rewarded eCPM.** The best dataset omits India and Indonesia entirely. The
   $0.80–3.00 band is inference, not a source. Same for country-level figures for Germany,
   Indonesia, Egypt and Canada.
3. **What Google considers rewarded ad-load abuse.** No published number; developers asking Google
   directly did not get one. The suggested 3–5/day cap is judgement, instrumented-then-tightened.
4. **Any documented size limit for AdMob's `custom_data`.** (AppLovin MAX documents 8192 chars for
   its own equivalent; different product, not a safe assumption.)
5. **Any AdMob guidance on maximum SSV callback age, or on idempotency at all.**
6. **Apple's or Google's position on earned-only virtual currency.** Play's Payments policy has an
   explicit carve-out for _earned_ points (_quoted_, §4.4); Apple is **silent**, and §4.4's reading
   is textual. **Silence is not permission** — monitor it.
7. **Tenjin's 2026 benchmark** (best methodology found: 146bn impressions) publishes rewarded eCPM
   by country **only as charts with no numbers in text**; nothing from it is quotable. Business of
   Apps' rewarded-CPM page returned HTTP 403.
8. **Splitwise's official Pro price and exact free-tier cap.** Not published; the App Store IAP
   ladder is the only primary evidence.
9. **Duolingo's gems-per-ad rate**, and any public engineering write-up of how they tune earn rates.
   Confirmed absent, not unsearched.
10. **Whether Spotify Sponsored Sessions is still a live 2026 product.**
11. **A rigorously documented "watch an ad → get AI credits" app.** The trend is described only in
    vendor content marketing.
12. **A clean case of a rewarded-ad coin economy killed specifically by farming.** Does not appear
    to exist in public reporting.

**Consent and privacy** 13. **A finance-vertical ATT opt-in benchmark.** None found; published figures span 27–50%. 14. **A regulator-blessed pattern for "you declined, so this earn path is unavailable."** No
precedent, no guidance, no published DPA position. §6.6 is analysis, not authority, and the
EDPB's broader Consent-or-Pay guidelines are in the 2026–2027 work programme and do not exist
yet. 15. **Explicit Google documentation of GDPR-vs-IDFA message ordering.** The state machine in §6.6
comes from Google's Flutter privacy doc and the AdMob SDK forum, not from a page stating the
rule. Verify against the console's own preview before shipping. 16. **A complete authoritative list of US comprehensive-privacy states with original effective
dates.** Cite the live IAPP tracker.

**Costs and bank data** 17. **Google Cloud Speech-to-Text official per-minute rates** — page would not render across four
attempts; **secondary only, and the single most important figure to re-verify.** 18. **Google Document AI and Azure Document Intelligence per-page rates** — both JS-rendered;
Azure showed literal `$-` placeholders. Secondary only. (Azure's 500-free-pages tier is list.) 19. **Ocrolus and Inscribe pricing** — no public price; the $0.50–$2.00/page band is a converging
estimate. Same for Klippa (404), Docsumo paid tiers, and Plaid Statements/Assets. 20. **GPT-5-class image tokenisation rule** — not verified, so GPT is deliberately absent from the
VLM tables rather than guessed at. The `gpt-realtime` ~10 audio-tokens/sec assumption behind the
$0.0032/10s figure is also unverified. 21. **A regulator statement addressing document upload specifically.** EBA Q&As and FCA guidance
were searched; the conclusion rests on PERG 15.3's access test plus the PSD2 AIS definition —
sound, but a legal reading, not a quoted holding. 22. **FiDA's actual adoption date** — sources conflict, and the same 2025-11-27 provisional-agreement
date is attributed to both PSD3/PSR and FiDA in different write-ups. 23. **Published per-active-user-per-month cost figures for voice/OCR features.** None exist. The
§7.7 model is built from unit prices with assumptions stated inline; the agentic-workload
benchmarks that do exist describe a different workload and must not be cited as if they apply. 24. **Any incident involving a consumer expense-splitting app and uploaded statements.** None found
— a thin evidence base in a young category, not a safe harbour.

**One methodological note worth keeping.** During this research a widely repeated figure — India's
85% rewarded-ad completion rate — was discarded because fetching the cited source showed it did not
say that. That is the standard this document is written to: a clean "no reliable public source"
beats a laundered number, and every number above carries the label it earned.
