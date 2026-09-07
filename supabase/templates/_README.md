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
the exact shape of every phishing mail they will ever get. `otp_length = 8` in
config.toml, so the code is eight digits.

They are deliberately plain: inline styles, no images, no web fonts, one colour.
A code mail is read in two seconds in a notification shade, and every byte of
decoration is a byte that can render wrong in Outlook.

The Go template variables GoTrue exposes are `{{ .Token }}`, `{{ .TokenHash }}`,
`{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}` and `{{ .NewEmail }}`.
Anything else silently renders empty — there is no error, just a gap in
somebody's mail.
