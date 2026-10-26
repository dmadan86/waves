# Ads for Free users

Optional rewarded video ads on the Free plan, so a Free user can earn a little more instead of stopping. Off by default (flag
`ads_rewarded`, 0% rollout). Nothing is ever forced.

## Rules

| Topic          | Rule                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format         | Optional rewarded video plus one labelled native card in long Activity and Friends lists. No banners, interstitials or app-open ads.                                                                                                                                                                                           |
| Reward         | 1 completed ad = 2 AI voice commands or 2 receipt scans. The voice limit screen offers voice, the scan limit screen offers scans.                                                                                                                                                                                              |
| Daily cap      | 3 rewarded ads per day.                                                                                                                                                                                                                                                                                                        |
| Validity       | Valid for the calendar month (UTC) in which they are earned. Used after the monthly Free allowance (10 voice commands, 20 receipt scans).                                                                                                                                                                                      |
| Eligibility    | Free plan only. Not Pro (including legacy Plus), not the 15-day Pro trial, not guests, account at least 7 days old, and flag `ads_rewarded` on for the user.                                                                                                                                                                   |
| Placement      | Visible links on Voice, receipt scan entry and Settings, plus quota fallback: a small sheet with "Watch a short ad for 2 more AI voice commands", "Upgrade to Pro" and "Not now".                                                                                                                                              |
| Never shown on | Balances, groups, settle-up, the paywall, widgets, the watch or notifications. Native cards appear only in Activity and Friends after the eighth row, with at least nine rows.                                                                                                                                                 |
| Privacy        | Google AdMob, non-personalized ads only (`requestNonPersonalizedAdsOnly`, `npa=1`). No advertising-ID tracking, no ATT prompt on iOS. Google UMP consent is used where legally required (EEA, UK, Switzerland). AdMob receives the device and IP-level information needed to serve ads and prevent fraud, per Google's policy. |

## Architecture

```
client sheet
  -> AdMob rewarded ad (SSV options: user_id = profile id, custom_data = kind)
  -> Google calls https://ywojpnfyxxltvihqmcni.supabase.co/functions/v1/admob-ssv
  -> edge function admob-ssv verifies Google's ECDSA signature against
     https://www.gstatic.com/admob/reward/verifier-keys.json
  -> SECURITY DEFINER SQL function waves_ads_grant
  -> ad_rewards row
  -> credited into waves_voice_agent_quota / waves_receipt_scan_quota for the month
```

- The app never grants a reward locally; it only waits for the server to credit it.
- `kind` is `voice` or `scan`; it travels as AdMob `custom_data` and `user_id` is the
  profile id, both inside Google's signature, so the server reads them from the signed query.
- Eligibility is decided by the server (`waves_my_ads_status` for the app, and again in
  `waves_ads_grant` when the callback arrives). People in the Pro trial's 30-day voice pool
  are not offered ads either. The daily cap counts UTC days. After "Not now" the same
  offer stays quiet on that phone for 10 minutes.
- A callback is idempotent on AdMob's `transaction_id` (`ad_rewards.transaction_id` is
  UNIQUE). A callback for an unknown ad unit, user or kind is acknowledged and ignored.
- The credit is part of the month's allowance: `waves_voice_agent_quota` adds the month's
  `voice` rewards to Free's 10, `waves_receipt_scan_quota` adds the month's `scan` rewards
  to Free's 20. So bonus units are used after the monthly allowance, and a refunded
  command is given back. They expire with the UTC month they were earned in.
- The server accepts a callback only for ad unit ids listed in the secret
  `ADMOB_AD_UNIT_IDS` (comma-separated numeric ids).

## Config table: `ad_reward_settings`

| Column                 | Default | Meaning                            |
| ---------------------- | ------- | ---------------------------------- |
| `voice_per_ad`         | 2       | AI voice commands per completed ad |
| `scans_per_ad`         | 2       | Receipt scans per completed ad     |
| `daily_cap`            | 3       | Rewarded ads per user per day      |
| `min_account_age_days` | 7       | Minimum account age to be eligible |

Tune with SQL (the table has exactly one row):

```sql
update ad_reward_settings set voice_per_ad = 3, daily_cap = 2;
```

## Feature flag `ads_rewarded`

Rolled out at 0%. Individual people are enabled through the `ads_allowlist` table:

```sql
insert into ads_allowlist (profile_id, note)
values ('<profile uuid>', 'tester')
on conflict do nothing;
```

Remove with `delete from ads_allowlist where profile_id = '<id>'`. Raise the flag's
rollout percentage only after the console checklist below is done.

## Testing with Google's test ads

Builds use Google's TEST app ids and test rewarded units until the env vars below are set.
Test ads reward nobody unless their unit id is in `ADMOB_AD_UNIT_IDS`: for a test run
add `5224354917` (Android) and `1712485313` (iOS) to the secret, put yourself on
`ads_allowlist`, and make your account at least 7 days old (or set
`min_account_age_days` to 0 while testing). Remove the test ids afterwards.

## Voice routing and the quality tradeoff

- Free (including ad-granted) AI voice commands use the phone's own speech
  recognition and send the text to the cloud model.
- Deepgram is for Pro and the trial, live or as a clip. `waves_voice_stream_mint`
  refuses Free (403 `VOICE_STREAM_FREE_TIER` from `voice-stream`), and `voice-agent`
  refuses a Free clip with the same code before any byte reaches Deepgram, so this
  is enforced on the server, not only in the app. (`voice-stream-token` is retired:
  it answers 410 and stays deployed as that tombstone until deleted.) A clip is
  measured from its container before upload (PCM WAV or MP4/M4A only; anything
  else is refused with 415).
- A sentence the phone's own parser reads with full confidence is not sent to the model
  and does not use up an allowance for Free.
- Tradeoff: on-device recognition is weaker than the cloud engine, especially for
  Tamil and Arabic. Free users in those languages may see more mis-heard commands.
  This is not mentioned in marketing copy.

## Reward math (estimates)

All numbers are estimates and must be replaced by AdMob console actuals.

Cost per unit: AI voice command about Rs 0.03 on-device speech plus a Haiku-class
LLM (about Rs 0.2 with Deepgram streaming, which Free no longer uses); receipt
scan about Rs 0.06. Rewarded-video revenue per view: India about Rs 0.10 to 0.30,
US/UK about Rs 0.8 to 1.7. Hence 2 units per ad.

| Item                           | Cost per ad | Revenue per view (India) | Revenue per view (US/UK) | Margin per ad (India) | Margin per ad (US/UK) |
| ------------------------------ | ----------- | ------------------------ | ------------------------ | --------------------- | --------------------- |
| Rewarded voice ad (2 commands) | Rs 0.06     | Rs 0.10 to 0.30          | Rs 0.8 to 1.7            | Rs 0.04 to 0.24       | Rs 0.74 to 1.64       |
| Rewarded scan ad (2 scans)     | Rs 0.12     | Rs 0.10 to 0.30          | Rs 0.8 to 1.7            | Rs -0.02 to 0.18      | Rs 0.68 to 1.58       |

Worst case, 3 ads every day for 30 days (90 ads a month):

| Case          | Cost / month | Revenue (India) | Revenue (US/UK) | Margin (India)    | Margin (US/UK)     |
| ------------- | ------------ | --------------- | --------------- | ----------------- | ------------------ |
| All voice ads | Rs 5.40      | Rs 9 to 27      | Rs 72 to 153    | Rs 3.60 to 21.60  | Rs 66.60 to 147.60 |
| All scan ads  | Rs 10.80     | Rs 9 to 27      | Rs 72 to 153    | Rs -1.80 to 16.20 | Rs 61.20 to 142.20 |

At the low end of Indian revenue a scan ad is roughly break-even to slightly
negative. If actuals land there, lower `scans_per_ad` to 1 or the cap.

## Environment variables

| Name                                 | Where                               | Purpose                                                     |
| ------------------------------------ | ----------------------------------- | ----------------------------------------------------------- |
| `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID` | mobile build env                    | Android rewarded ad unit id (Google TEST id until replaced) |
| `EXPO_PUBLIC_ADMOB_REWARDED_IOS`     | mobile build env                    | iOS rewarded ad unit id                                     |
| `ADMOB_ANDROID_APP_ID`               | read in `apps/mobile/app.config.ts` | Android AdMob app id                                        |
| `ADMOB_IOS_APP_ID`                   | read in `apps/mobile/app.config.ts` | iOS AdMob app id                                            |
| `ADMOB_AD_UNIT_IDS`                  | Supabase function secret            | Comma-separated numeric ad unit ids allowed to reward       |
| `NEXT_PUBLIC_ADMOB_PUBLISHER_ID`     | website env (Vercel)                | Publisher id for `/app-ads.txt` (with or without `pub-`)    |

The website serves `google.com, pub-<id>, DIRECT, f08c47fec0942fa0` at
`/app-ads.txt` and answers 404 while the variable is unset or not digits.

## Checklist: AdMob console

- [ ] Create the app in AdMob, for Android and for iOS.
- [ ] Create a rewarded ad unit for each platform.
- [ ] Enable server-side verification on each rewarded ad unit, callback URL
      `https://ywojpnfyxxltvihqmcni.supabase.co/functions/v1/admob-ssv`.
- [ ] Block sensitive ad categories: loans and personal finance, gambling and betting,
      crypto, dating.
- [ ] Set the maximum ad content rating to G or PG.
- [ ] Add app-ads.txt: served at `https://<website domain>/app-ads.txt`. The developer
      website URL in both store listings must match that domain.
- [ ] Set the secrets and env vars above (`ADMOB_AD_UNIT_IDS`, the app ids, the two
      `EXPO_PUBLIC_ADMOB_REWARDED_*` ids, `NEXT_PUBLIC_ADMOB_PUBLISHER_ID`).
- [ ] Replace the Google TEST ids with the real ones before release.
- [ ] In AdMob Privacy & messaging, create the EEA/UK/CH consent message (GDPR), and
      the US states regulations message if wanted.

## Checklist: store privacy forms

### Play Console, Data safety

- [ ] Declare data collected by AdMob: Device or other IDs; Approximate location (from
      IP); App interactions (ad interactions and diagnostics).
- [ ] Purposes: Advertising or marketing, and Fraud prevention.
- [ ] Mark as shared with a third party (Google AdMob).
- [ ] Not used for tracking when non-personalized: ads are non-personalized and the
      data is not used to build a profile across apps.
- [ ] Advertising ID declaration: confirm in Play Console. The app uses AdMob, so
      declare yes for advertising purposes; with non-personalized ads the ID is not
      used for ad personalization. `com.google.android.gms.permission.AD_ID` can be
      removed via the plugin option or the manifest only if no advertising ID use remains.

### App Store, privacy labels

- [ ] Add Device ID, Coarse location, Product interaction and Advertising data as
      applicable.
- [ ] Purpose: Third-party advertising.
- [ ] "Used to track you": No, because ads are non-personalized and there is no ATT.
- [ ] No ATT prompt is shown, and the iOS `Info.plist` keeps
      `NSUserTrackingUsageDescription` absent.

### Website

- [ ] The privacy policy (`/privacy`) already has an Advertising section; re-read it
      against the final store answers.

## Native list cards

`ads_native` is seeded OFF with 0% rollout. It also requires the same affirmative
`waves_my_ads_status` eligibility as rewarded ads (including no paid plans or trials).
One placement follows eight real rows; Activity date headings do not count. Friends
selection mode hides the card. Requests start when the placement approaches the viewport,
require UMP `canRequestAds`, and are non-personalised. Native assets and media use
the SDK native view, including its AdChoices overlay. No financial data is sent.

The local per-account UTC-day cap is three request reservations shared across both
screens and persisted before requesting, so failed loads also consume a slot. This
conservatively bounds impressions to three on this installation; it is not a cross-device cap.

Create one **native** AdMob unit per platform and set build environment variables
`EXPO_PUBLIC_ADMOB_NATIVE_ANDROID` and `EXPO_PUBLIC_ADMOB_NATIVE_IOS`. Development
and missing configuration use Google's platform test native units. Native units
do not need rewarded SSV configuration or inclusion in `ADMOB_AD_UNIT_IDS`. Existing
AdMob app IDs and Expo plugin configuration are shared; generated android files
are not edited. Enable the new flag only after console units, consent messages,
category restrictions and store privacy declarations are ready.

Banner placements `review_banner` and `home_banner` also require an affirmative
`bannerEligible` decision from `waves_my_ad_gate_status`: Free accounts must be at
least 15 days old by default, configurable in admin with “Banner minimum account
age (days)” (`banner_min_account_age_days`, 0–365). Profiles in `ads_allowlist`
bypass this age check for testing, but still require the `ads_gates` master switch
and all existing eligibility checks. Home banners still require at least 10 groups.
