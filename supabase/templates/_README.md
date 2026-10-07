# Auth email templates

The mail GoTrue sends — the sign-in code, the sign-up code, the address change.
Not the product mail: that is built in `packages/core/src/notifications/email.ts`
and sent by `notify-fanout`. These are the ones Supabase sends on our behalf,
and they are here because `config push` uploads them (`[auth.email.template.*]`
in `supabase/config.toml`), so what a person receives is in the repo rather than
in a console text box nobody can diff.

**Every one of them prints `{{ .Token }}` and none of them links.** The app asks
for a code on a six-box screen (`verify-email.tsx`, `phone.tsx`) — a magic link
lands somebody on a page with nothing to type into, and a mail that contains
both teaches people to click the link in a message asking for a code, which is
the exact shape of every phishing mail they will ever get. `otp_length = 6` in
config.toml, matching `OTP_LEN` in the app — the two are checked against each
other by `apps/mobile/test/otpLength.test.ts`, because at 8 the mail carried a
code the six-box screen silently truncated.

Layout follows an OpenRouter-style verification-code mail: plain white page,
600px column, system font stack, table layout with inline styles, no web fonts.
Top-left the Waves mark; an "Verification code" heading; one sentence naming what
the code is for; the code at 40px bold and letter-spaced; the expiry and a
do-not-share line; a bold "Didn't request this?" block; a dashed rule and a
muted footer. Colours are set explicitly and the page declares
`color-scheme: light only`, so a dark-mode client does not invert the code into
low contrast.

Things in the layout that are not decoration:

- **The expiry is a number**, not "shortly". It has to match `otp_expiry` in
  `config.toml`, and `apps/mobile/test/otpLength.test.ts` fails if it does not.
- **The address is named** in the footer (`{{ .Email }}`): the cheapest phishing
  tell there is.
- **The preview text** (hidden `div`) opens with the code, like the subject.
- **The code is a single `{{ .Token }}`**, never split per digit, so it stays
  selectable and Gmail / autofill can read it. Letter-spacing is CSS only.

**Logo.** No hosted logo PNG exists on the public site or CDN today (the only
brand art is in `infra/art/brand/` and the mobile assets, none served over
https), and Gmail strips inline SVG and data URIs. So the mark is a bold
"Waves" wordmark in brand purple `#7A5AF8`. To use the real logo, host a PNG
(about 120px wide, 2x) at a stable https URL, e.g. under `https://wavs.co.in/`,
and swap it into the `<p>` at the top of each template with `alt="Waves"`.

**IP / location.** The OpenRouter original shows the requester's IP and city.
Supabase's template variables cannot: only `.Token`, `.Email`, `.SiteURL`,
`.TokenHash`, `.RedirectTo`, `.Data` and `.NewEmail` exist. Showing where a
sign-in came from would need a Send Email hook (an Edge Function that receives
the request and sends the mail itself), which is a separate piece of work.

**The code is in the subject** (`config.toml`), first: "123456 is your Waves
verification code" and its siblings per template. Gmail and the phones'
autofill read that as a one-time code (Gmail's "Copy code" chip, digits in the
notification). Gmail's chip is its own classifier, so nothing here forces it.
Sender reputation matters too: SPF, DKIM and DMARC for `wavs.co.in` live in DNS
and Resend, not in this repo (see `README.md`, "Turning on email").

`apps/mobile/test/otpLength.test.ts` holds every subject's shape and the
template wording.

The Go template variables GoTrue exposes are `{{ .Token }}`, `{{ .TokenHash }}`,
`{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}` and `{{ .NewEmail }}`.
Anything else silently renders empty — there is no error, just a gap in
somebody's mail.
