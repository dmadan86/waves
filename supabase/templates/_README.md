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

They are deliberately plain: table layout, inline styles, no images, no web
fonts. A code mail is read in two seconds in a notification shade, and every byte
of decoration is a byte that can render wrong in Outlook.

Three things in the layout are not decoration, and each was taken from how the
apps that do this well handle it on screen:

- **The code sits in its own bordered field**, tracked wide, rather than loose in
  a paragraph. Per-digit boxes would be better still — that is what the app's own
  screen shows — but a Go template cannot slice a string, so one field with
  letter-spacing is as close as this gets.
- **The expiry is a number**, not "shortly". It has to match `otp_expiry` in
  `config.toml`, and `apps/mobile/test/otpLength.test.ts` fails if it does not:
  a mail promising fifteen minutes against a server that allows sixty is the app
  lying about something somebody only discovers by being refused.
- **The address is named** in the footer (`{{ .Email }}`). It costs a line and it
  is the cheapest phishing tell there is — a code mail that cannot say who it was
  sent to did not come from us.

The hidden `div` at the top is preview text: what an inbox list shows beside the
subject. Left out, mail clients show the first words of the markup instead.

The Go template variables GoTrue exposes are `{{ .Token }}`, `{{ .TokenHash }}`,
`{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}` and `{{ .NewEmail }}`.
Anything else silently renders empty — there is no error, just a gap in
somebody's mail.
