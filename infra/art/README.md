# Remote artwork (`waves-art` bucket)

Illustrations the app fetches at runtime rather than ships. They live here so
the source of truth is versioned, and in a **public** Cloudflare R2 bucket so a
phone can fetch one without a credential. They are deliberately **outside
`apps/mobile/`**: anything under the app directory risks being swept into the
binary by `assetBundlePatterns`, and the whole point is that an install does not
carry them.

The app reads them through `apps/mobile/src/lib/art.ts`. Every screen that draws
one also draws something without it — the feedback cards fall back to a glyph —
so a phone that never reaches the bucket still gets a working screen.

## Licence and attribution

Source: **[Storyset](https://storyset.com/)** (Freepik), `rafiki` style, free
licence **with attribution**. The credit is shown in two places in the app, and
both are required, not decorative:

- under the card grid on the feedback screen (`feedbackArtCredit`), and
- in Settings → Licenses, under _Artwork_.

Storyset's licence permits recolouring, and these are recoloured: the blue
family (hue 205–240, saturation above 0.12) is rotated onto the Waves brand
purple, leaving skin tones, greys and the warm accents alone. Then each one is
trimmed to its alpha bounding box, scaled to 440px on its long edge and saved as
WebP — ~20–35 KB each, about 200 KB for the set.

| File             | Storyset illustration    |
| ---------------- | ------------------------ |
| `splitting.webp` | cash-payment (rafiki)    |
| `receipts.webp`  | receipt (rafiki)         |
| `voice.webp`     | voice-assistant (rafiki) |
| `groups.webp`    | group (rafiki)           |
| `speed.webp`     | fast-loading (rafiki)    |
| `design.webp`    | design-tools (rafiki)    |
| `bug.webp`       | bug-fixing (rafiki)      |
| `idea.webp`      | new-idea (rafiki)        |

## Publishing

The bucket holds **public, non-sensitive** artwork only. It is not the image
bucket: receipts, avatars and group photos live in the private bucket reached
through the `r2-sign` edge function, and nothing in this directory ever goes
near a private object.

```sh
wrangler login                                   # once
wrangler r2 bucket create waves-art              # once
pnpm art:publish                                 # uploads everything here
```

The bucket is served from a custom domain, which is the default in
`lib/art.ts`:

    https://assets.wavs.co.in

A custom domain rather than the bucket's `pub-<hash>.r2.dev` address, because
an r2.dev URL names a bucket on a particular vendor and would be baked into
every build that ever shipped; this one can be pointed elsewhere without a
release. (`wrangler r2 bucket dev-url enable waves-art` turns the r2.dev
address on as well, and `wrangler r2 bucket dev-url get waves-art` prints it.)

`EXPO_PUBLIC_ART_BASE_URL` overrides the default — for a staging bucket or a
local server. Changing either reaches phones without another native build.

Re-running the publish overwrites in place, so a redrawn illustration reaches
every phone as soon as its cache expires — no app release involved.
