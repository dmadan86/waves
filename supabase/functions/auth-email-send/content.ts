/**
 * What each auth mail says. A TypeScript port of `supabase/templates/*.html` and
 * the `subject` lines in `[auth.email.template.*]` — with the Send Email Hook
 * on, GoTrue no longer renders those, so this is the copy that ships. Wording is
 * deliberately identical; change both together (or retire the templates).
 *
 * Code mails lead the subject with the code ("123456 is your Waves ... code"),
 * which is the shape Gmail reads as a one-time code. None of them link, apart
 * from `invite`, whose GoTrue default is a link and which has no template here.
 */

/** Action types that carry a code and so get an `OTP-Token` header. */
export type CodeAction =
  'signup' | 'magiclink' | 'recovery' | 'reauthentication' | 'invite' | 'email_change';

export const NOTIFICATION_ACTIONS = [
  'password_changed_notification',
  'email_changed_notification',
  'phone_changed_notification',
  'identity_linked_notification',
  'identity_unlinked_notification',
  'mfa_factor_enrolled_notification',
  'mfa_factor_unenrolled_notification',
] as const;

export type NotificationAction = (typeof NOTIFICATION_ACTIONS)[number];

export function isCodeAction(action: string): action is CodeAction {
  return ['signup', 'magiclink', 'recovery', 'reauthentication', 'invite', 'email_change'].includes(
    action,
  );
}

export function isNotificationAction(action: string): action is NotificationAction {
  return (NOTIFICATION_ACTIONS as readonly string[]).includes(action);
}

export interface Rendered {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface CodeCopy {
  readonly subject: (code: string) => string;
  readonly lead: (newEmail: string) => string;
  readonly ignore: string;
}

const CODE_COPY: Record<CodeAction, CodeCopy> = {
  magiclink: {
    subject: (c) => `${c} is your Waves verification code`,
    lead: () => 'Enter this code in the Waves app to sign in.',
    ignore: "If you didn't try to sign in to Waves, you can safely ignore this email",
  },
  signup: {
    subject: (c) => `${c} is your Waves sign-up code`,
    lead: () => 'Enter this code in the Waves app to confirm your email.',
    ignore: "If you didn't try to create a Waves account, you can safely ignore this email",
  },
  email_change: {
    subject: (c) => `${c} is your code to confirm your new Waves email`,
    lead: (e) => `Enter this code in the Waves app to confirm your new email, ${e}.`,
    ignore:
      "If you didn't try to change the email on your Waves account, you can safely ignore this email",
  },
  recovery: {
    subject: (c) => `${c} is your Waves password reset code`,
    lead: () => 'Enter this code in the Waves app to reset your password.',
    ignore: "If you didn't ask to reset your Waves password, you can safely ignore this email",
  },
  reauthentication: {
    subject: (c) => `${c} is your Waves confirmation code`,
    lead: () => "Enter this code in the Waves app to confirm it's you.",
    ignore: "If you didn't try to make a change in Waves, you can safely ignore this email",
  },
  invite: {
    subject: (c) => `${c} is your Waves invitation code`,
    lead: () => "You've been invited to join Waves. Enter this code in the Waves app to accept.",
    ignore: "If you weren't expecting an invitation to Waves, you can safely ignore this email",
  },
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const ICON =
  'https://ywojpnfyxxltvihqmcni.supabase.co/storage/v1/object/public/email-assets/waves-icon-192.png';

function shell(opts: { preview: string; heading: string; body: string }): string {
  const { preview, heading, body } = opts;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: #ffffff">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent; height: 0; width: 0">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff" bgcolor="#ffffff">
      <tr>
        <td align="center" style="padding: 40px 24px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px">
            <tr>
              <td style="font-family: ${FONT}; color: #111827; text-align: left">
                <img src="${ICON}" width="64" height="64" alt="Waves" style="display: block; width: 64px; height: 64px; border: 0; border-radius: 14px; margin: 0 0 32px" />
                <h1 style="margin: 0 0 12px; font-size: 24px; line-height: 1.3; font-weight: 700; color: #111827">${escapeHtml(heading)}</h1>
${body}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top: 1px dashed #d1d5db">
                  <tr>
                    <td style="padding-top: 24px; font-family: ${FONT}; font-size: 13px; line-height: 1.6; color: #6b7280">&copy; 2026 Waves &middot; wavs.co.in</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

const P = 'margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #374151';

export function renderCodeEmail(
  action: CodeAction,
  code: string,
  opts: { newEmail?: string; link?: string } = {},
): Rendered {
  const copy = CODE_COPY[action];
  const lead = copy.lead(opts.newEmail ?? '');
  const link = opts.link
    ? `                <p style="${P}"><a href="${escapeHtml(opts.link)}" style="color: #111827">Or open this link to accept</a></p>\n`
    : '';
  const html = shell({
    preview: `${code} is your Waves code. It expires in 15 minutes.`,
    heading: 'Verification code',
    body: `                <p style="${P}">${escapeHtml(lead)}</p>
                <p style="margin: 0 0 24px; font-size: 40px; line-height: 1.2; font-weight: 700; letter-spacing: 8px; color: #111827">${escapeHtml(code)}</p>
${link}                <p style="margin: 0 0 40px; font-size: 16px; line-height: 1.6; color: #374151">This code expires in 15 minutes. To protect your account, don't share it with anyone.</p>
                <p style="margin: 0 0 8px; font-size: 16px; line-height: 1.6; font-weight: 700; color: #111827">Didn't request this?</p>
                <p style="margin: 0 0 32px; font-size: 16px; line-height: 1.6; color: #374151">${escapeHtml(copy.ignore)} &mdash; no one can get in without this code.</p>`,
  });
  const text = [
    lead,
    '',
    code,
    '',
    ...(opts.link ? [`Or open this link to accept: ${opts.link}`, ''] : []),
    "This code expires in 15 minutes. To protect your account, don't share it with anyone.",
    '',
    `Didn't request this? ${copy.ignore} - no one can get in without this code.`,
  ].join('\n');
  return { subject: copy.subject(code), html, text };
}

const NOTICE: Record<NotificationAction, { subject: string; line: string }> = {
  password_changed_notification: {
    subject: 'Your Waves password was changed',
    line: 'The password on your Waves account was just changed.',
  },
  email_changed_notification: {
    subject: 'Your Waves email was changed',
    line: 'The email address on your Waves account was just changed.',
  },
  phone_changed_notification: {
    subject: 'Your Waves phone number was changed',
    line: 'The phone number on your Waves account was just changed.',
  },
  identity_linked_notification: {
    subject: 'A new sign-in method was added to Waves',
    line: 'A new sign-in method was just linked to your Waves account.',
  },
  identity_unlinked_notification: {
    subject: 'A sign-in method was removed from Waves',
    line: 'A sign-in method was just removed from your Waves account.',
  },
  mfa_factor_enrolled_notification: {
    subject: 'Two-step verification was turned on for Waves',
    line: 'A new two-step verification method was just added to your Waves account.',
  },
  mfa_factor_unenrolled_notification: {
    subject: 'Two-step verification was removed from Waves',
    line: 'A two-step verification method was just removed from your Waves account.',
  },
};

/** Security notices carry no code, so they get no `OTP-Token` header. */
export function renderNotificationEmail(action: NotificationAction): Rendered {
  const { subject, line } = NOTICE[action];
  const tail = "If this wasn't you, contact hello@wavs.co.in right away.";
  return {
    subject,
    html: shell({
      preview: line,
      heading: subject,
      body: `                <p style="${P}">${escapeHtml(line)}</p>\n                <p style="margin: 0 0 32px; font-size: 16px; line-height: 1.6; color: #374151">${escapeHtml(tail)}</p>`,
    }),
    text: `${line}\n\n${tail}`,
  };
}
