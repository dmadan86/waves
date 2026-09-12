# Signing in over WhatsApp

The phone code travels over WhatsApp, not SMS. This is what has to be true for
it to work, in the order it has to become true, and how to tell which piece is
missing when it does not.

Everything in the app and in the edge function is already built and deployed.
What is left is an account with Twilio, an approved template, six secrets and one
switch — none of which live in this repository.

## Why not SMS

The long form is at the top of
[`supabase/functions/otp-send/handler.ts`](../supabase/functions/otp-send/handler.ts)
and in the `[auth.sms]` comments in
[`supabase/config.toml`](../supabase/config.toml). Briefly:

1. **India is the first market**, and A2P SMS there is gated on DLT registration
   with the operators through TRAI. Unregistered traffic is dropped by the
   carrier, not by Supabase — there is nothing to debug and nothing to retry.
   WhatsApp business messaging is not A2P SMS and carries none of that paperwork.
2. **A per-number cap can only be enforced where the client cannot skip it.** The
   app calls GoTrue directly, so a limit written into the app is advice a
   modified client ignores. In the hook it is the only door.
3. It is markedly cheaper per message, and the code lands in an app people
   already have open.

This is also why Twilio _Verify_ is switched off. Verify mints and checks its own
code; inside a send hook that would put two different codes in play and neither
one would validate. Owning delivery means owning plain Programmable Messaging.

## How it fits together

```
app  ──signInWithOtp──▶  GoTrue  ──signed POST──▶  otp-send  ──▶  Twilio  ──▶  WhatsApp
                           │                          │
                    generates the code          counts it, then sends it
```

GoTrue generates the code and would normally post it to an SMS provider itself.
With `[auth.hook.send_sms]` pointed at `otp-send` it posts to us instead and we
decide how the code travels. The app is unchanged by any of this: it calls
`signInWithOtp` and `verifyOtp` with `type: 'sms'` either way.

## What is already done

Verified against the Mumbai project (`ywojpnfyxxltvihqmcni`) on 2026-09-12:

- `otp-send` is deployed and `ACTIVE`, with `verify_jwt = false` — the caller is
  GoTrue, which carries no user session. What it carries instead is a
  standardwebhooks signature, checked before anything else is read.
- The client side is finished: `sendOtp`/`verifyOtp` in
  [`apps/mobile/src/lib/auth.tsx`](../apps/mobile/src/lib/auth.tsx), the screen at
  [`apps/mobile/src/app/phone.tsx`](../apps/mobile/src/app/phone.tsx).
- The daily cap is in `LIMITS['otp-send']` and enforced by the hook.

## What is not

- No `TWILIO_*` or `SEND_SMS_HOOK_SECRET` secrets are set on the project.
- `[auth.hook.send_sms] enabled = false`.
- `[auth.sms] enable_signup = false`, and it stays that way (ADR-006): a number
  signs somebody back in or attaches to an account a guest already has. It never
  opens a new one.

## 1. A WhatsApp sender

Twilio Console → Messaging → Senders → WhatsApp senders → sign up a sender.

Two things are needed that nobody has lying around: a **Meta Business Manager
account**, and a **phone number with no WhatsApp account on it**. If the number
has one, delete that account in the WhatsApp app first. Do not use a personal
number — it becomes the business sender, permanently.

**Start Meta business verification the same day.** It is free, it is separate
from Meta's paid products, it takes weeks, and until it clears you can message
250 unique recipients per 24 hours. Everything below can be built in parallel.

The Twilio Sandbox (Messaging → Try it out) is worth ten minutes to prove the
plumbing, but every tester has to join it by texting a code and it will not carry
the authentication template. It is not a staging environment.

## 2. The template

A business-initiated WhatsApp message must be a template Meta has approved,
referenced by its Content SID. Free-form text is only allowed inside a 24-hour
window that a sign-in has no reason to be in.

Console → Content Template Builder → Create → type **Authentication**
(`twilio/authentication`), copy-code button, language `en`. Submit for approval;
authentication templates usually clear in minutes, because the body text is
Meta's own and there is nothing in it to reject.

Copy the `HX...` Content SID. That is `TWILIO_OTP_CONTENT_SID`.

The template has exactly one variable, the code, and the handler already fills
it (`ContentVariables: {"1": otp}`). Meta requires the code to be under 15
characters; GoTrue's is six.

The template's language is fixed at approval time and is not something the app
chooses per send, so a person using Waves in Tamil still gets an English
authentication message. Adding `ta`/`hi`/`ar` templates means one Content SID per
locale and a map in the handler — worth doing later, not worth blocking on.

## 3. Credentials

Console → Account → API keys & tokens → create a **standard API key**.

The handler prefers `TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET` over the account
auth token, and the reason is worth keeping: a key is scoped, it can be revoked on
its own, and losing it does not mean rotating the token every other integration
shares. The account SID is still required either way — an API key says who is
calling, never which account is billed, and the account SID is what addresses the
request.

## 4. The secrets, twice

The one signing secret has to be written in **two** places, because two different
runtimes need it and they are configured by different mechanisms. Generate it in
the Supabase dashboard (Authentication → Hooks → Send SMS hook) and copy the
whole `v1,whsec_...` string.

The edge function, which verifies the signature:

```sh
npx supabase secrets set --project-ref ywojpnfyxxltvihqmcni \
  SEND_SMS_HOOK_SECRET=v1,whsec_...   \
  TWILIO_ACCOUNT_SID=AC...            \
  TWILIO_API_KEY_SID=SK...            \
  TWILIO_API_KEY_SECRET=...           \
  TWILIO_WHATSAPP_FROM=whatsapp:+91... \
  TWILIO_OTP_CONTENT_SID=HX...
```

GoTrue, which creates it, from `supabase/.env` (gitignored):

```sh
SEND_SMS_HOOK_SECRETS=v1,whsec_...
```

Note the plural. `config.toml` reads `env(SEND_SMS_HOOK_SECRETS)`, and
`supabase secrets set` does **not** reach GoTrue — a hook configured that way is
signed by nobody and refused by us. Same value in both, or every genuine request
is answered 401 while the function looks deployed and the hook looks enabled.

## 5. The switch

In `config.toml`, `[auth.hook.send_sms] enabled = true`. Then:

```sh
npx supabase config push --project-ref ywojpnfyxxltvihqmcni
```

**Read the whole file before pushing.** Anything it does not say, the CLI supplies
a default for and pushes anyway, silently overwriting whatever the dashboard had.
The first push on this project turned off anonymous sign-ins, manual identity
linking and email confirmation in one go — and anonymous sign-ins is the guest
flow, which is the app.

Flip the switch in the same change that sets the secrets, never before. Enabled
without them, every send fails and somebody sits on the code screen waiting for a
message that was never posted.

## 6. Proving it

A dev build stubs the send and accepts `000000`, because there is usually no
Twilio account behind it and a walkable app matters more than a real message. To
exercise the real path, set `EXPO_PUBLIC_DEV_REAL_OTP=true` in
`apps/mobile/.env.local` and restart Metro. The guard stays anchored on `__DEV__`,
so the flag cannot resurrect the magic code in a release build.

Use a number that **already has an account**. Signup is off, so a new number is
refused by design, and that refusal is not a bug in the send path.

```sh
npx supabase functions logs otp-send --project-ref ywojpnfyxxltvihqmcni
```

| What you see                             | What it means                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 That signature does not match`      | The two copies of the hook secret differ. Step 4.                                                                                                     |
| `500 SEND_SMS_HOOK_SECRET is not set`    | The edge-function secret is missing entirely.                                                                                                         |
| `500 WhatsApp sending is not configured` | One of the `TWILIO_*` secrets is missing.                                                                                                             |
| `502` + `twilio whatsapp send failed`    | Twilio refused it. The real reason is in the log line beside it — it is never returned to the caller, because it can name the sender and the account. |
| `429`                                    | Four codes to that number today.                                                                                                                      |
| Nothing at all in the log                | GoTrue never called us: the hook is still disabled, or pointed at the wrong URL.                                                                      |

## The cap

Four codes to a number a day, from `LIMITS['otp-send']`, counted **before** the
message is sent. A provider outage therefore still burns an attempt; the
alternative — send first, count after — lets a script spend the whole day's
allowance before the first count lands.

If the limiter itself errors it fails open, the same trade the shared limiter
makes everywhere: the only way that happens is the database being unreachable,
and refusing every sign-in during a database blip does more damage than the abuse
it guards against.

## What this costs, and what it does not cover

Meta bills authentication-category templates per message, and India has its own
rate card. Check Twilio's WhatsApp pricing for IN before turning it on for
everybody rather than discovering it on an invoice.

There is **no SMS fallback**. A failed WhatsApp send leaves email OTP, Google and
Apple as the doors that still open. Adding one means a second branch in this
handler and nothing else — which was the third reason for owning delivery.

## If you want a different provider

The provider is about twenty-five lines in `handler.ts` and a different set of
secrets. The hook contract, the signature check, the cap and the whole app stay
exactly as they are, so this is not a decision that locks anything in.

- **Meta Cloud API, direct.** No reseller, so Meta's rate with nothing on top.
  You need the WABA and the approved template either way, so a BSP is adding an
  API shape and a margin. Costs you a Meta app and a System User permanent token
  to look after — the token on the API Setup page expires in 24 hours, which is
  the classic "it worked yesterday".
- **360dialog.** Cloud API resold at a flat monthly fee with no per-message
  markup, and an almost identical payload behind a `D360-API-KEY` header.
- **Indian BSPs** — AiSensy, Interakt, Wati, Gupshup, MSG91, Zoko. INR invoicing
  with GST and somebody to chase Meta verification on your behalf, which is worth
  real money given that it is the step measured in weeks. Gupshup and MSG91 also
  do SMS, so one vendor would cover the fallback this design does not have.

What none of them change is the slow part: a WhatsApp Business Account, Meta
business verification, a number not already on WhatsApp, and an approved
authentication template.

## Turning it off

Set `[auth.hook.send_sms] enabled = false` and push the config. GoTrue goes back
to having no SMS provider, phone sign-in stops working, and every other door —
email, Google, Apple, guest — is untouched. The secrets can stay; a disabled hook
never reads them.
