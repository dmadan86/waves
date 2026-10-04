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

- **The code sits alone on its own line.** `magic_link` — the sign-in code,
  the one people see most — renders it as plain digits: no box, no border, no
  background, no letter-spacing, bold and larger than body text and nothing
  else. That was a deliberate change (see below); the other four still use a
  bordered, letter-spaced field, which is a worse match for autofill but costs
  nothing on a code that has no caller in the app today (`recovery`,
  `reauthentication`) or is seen far less often.
- **The expiry is a number**, not "shortly". It has to match `otp_expiry` in
  `config.toml`, and `apps/mobile/test/otpLength.test.ts` fails if it does not:
  a mail promising fifteen minutes against a server that allows sixty is the app
  lying about something somebody only discovers by being refused.
- **The address is named** in the footer (`{{ .Email }}`). It costs a line and it
  is the cheapest phishing tell there is — a code mail that cannot say who it was
  sent to did not come from us.

The hidden `div` at the top is preview text: what an inbox list shows beside the
subject. Left out, mail clients show the first words of the markup instead. It opens
with the code for the same reason the subject does.

**The code is in the subject** (`config.toml`). Four templates still read "Use
code 123456 to ...", which is what Gmail and the phones' autofill read as a
one-time code: Gmail draws it above the mail as digit boxes with a Copy
button, and it is readable in the notification without opening anything. The
boxes are Gmail's, not ours; the mail itself keeps its single field. GoTrue
runs the subject through the same Go template as the body, so `{{ .Token }}`
works there.

`magic_link`'s subject instead reads "123456 is your Waves verification code
(OTP)" — code first, the way Google's and Amazon's own sign-in-code mail does,
because a notification shade truncates the end of a subject before the start,
and it names both "verification code" and "OTP" rather than just one, since
Gmail's own OTP classifier (the one that draws the "Code requested — Copy
code" card above a mail it recognises) is known to key off that vocabulary. A
shorter label like "Waves OTP: 123456" was considered and dropped: a
colon-separated label reads more like the shape bulk senders use than a
sentence does. The body was rewritten the same way — "Your one-time password
(OTP) for Waves is:", the digits alone on their own line, then "This OTP
expires in 15 minutes." — mirroring a mail (CDSL's transaction-OTP mail) that
reliably triggers Gmail's card, rather than inventing a shape and hoping.
Gmail's card is Gmail's own ML classifying the mail; nothing here can force it
to fire, so this is the mail shaped to make that classification as easy as
Gmail's own documented examples make it, not a guarantee of the card.

The per-digit letter-spacing (and before that, the bordered box) in the old
layout is the thing most likely to have worked against this: both are the
same visual trick of drawing a "code field", and nothing in Gmail's own
example of a mail that triggers the card does either. This redesign removes
it from `magic_link` for that reason, not just for the brand colour.

Sender reputation plays into this too, separately from the mail's shape.
`[auth.email.smtp]` in `config.toml` already points GoTrue at Resend
(`smtp.resend.com:465`) with `admin_email = "hello@wavs.co.in"` and
`sender_name = "Waves"` — the sending identity is configured here, in the
repo. What is **not** in the repo, because it is DNS rather than a file this
project owns a copy of: whether `wavs.co.in`'s SPF, DKIM and DMARC records are
published and aligned, which `README.md`'s "Turning on email" section
describes as a one-time step done in the Resend dashboard and the domain's
DNS, not here. There is no BIMI record for the domain either — that would be
what lets a verified sender show its logo or a checkmark next to the mail, on
top of (not instead of) SPF/DKIM/DMARC. None of that is changed by this
redesign; it is called out because an unauthenticated sender is unlikely to
get Gmail's card no matter how the body reads.

`apps/mobile/test/otpLength.test.ts` holds every subject's shape — `magic_link`
is checked against its own pattern, the other four against the shared one.

The Go template variables GoTrue exposes are `{{ .Token }}`, `{{ .TokenHash }}`,
`{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Email }}` and `{{ .NewEmail }}`.
Anything else silently renders empty — there is no error, just a gap in
somebody's mail.
