# Campaign links

Waves tells you which ad or link an install came from without an ad SDK and
without any advertising identifier. The campaign tag is three short lowercase
words (`source`, `medium`, `campaign`) sent once, on the `app_installed` event.

## Android (Google Play)

Add a `referrer` to the Play link, URL-encoded:

```
https://play.google.com/store/apps/details?id=app.waves.mobile&referrer=utm_source%3Dmeta%26utm_medium%3Dpaid%26utm_campaign%3Dname
```

- `utm_source`: where (`meta`, `google`, `youtube`, `newsletter`).
- `utm_medium`: how (`paid`, `organic`, `email`).
- `utm_campaign`: your name for it (`diwali_in`).

Each value is lowercased and must be only `a-z 0-9 _ -`, at most 40 characters;
anything else is dropped. Other params (`gclid`, `fbclid`, `waves_ref`, emails)
are never stored. A plain Play install reads `utm_source=google-play&utm_medium=organic`.

## iOS (App Store)

iOS has no install referrer, so every iOS install is recorded with
`source = app_store` and no campaign. Apple campaigns are measured in App
Store Connect instead: App Store Connect > your app > Campaign Links (or the
App Analytics page) > create a campaign link, which gives a link with
`?pt=<provider id>&ct=<campaign name>`. Use that link in the ad, then read
installs and downloads per campaign under App Analytics > Sources > Campaigns.
Those numbers do not appear in the Campaigns table here.

## Reading it

Admin > KPIs > Campaigns shows, for the last 30 days, per source / medium /
campaign: installs, registered (the install later got a non-guest account),
activated (the account made an expense, settlement or personal record within 7
days; only accounts at least 7 days old count) and paid Pro plans (comped
grants excluded).

Cost per activated user = ad spend (from the ad platform) / activated (from
this table).

## Privacy

No advertising identifier (GAID, IDFA), no ad SDK and no click id is read or
stored. The tag is only what you put in the link, and the settings Privacy
screen says so.
