/**
 * Turning inbox rows into email (TDR §7.3).
 *
 * The same shape as `push.ts` and for the same reason: the sending is a `fetch`
 * in an edge function, and everything that can be got wrong is here, where a
 * test can read it without a mailbox.
 *
 * Three things this file decides:
 *
 *   * **What is worth an email at all.** Almost nothing is. Splitwise mails a
 *     person every time anybody buys a coffee, and the result is a filter rule.
 *     ADR-010 and TDR §7.3 allow a short list; `TEMPLATE_FOR_KIND` is that list
 *     written down, and a kind missing from it is a kind that never gets mailed
 *     no matter what the fanout is asked to do.
 *   * **What it says.** Nothing new. An email carries the same sentence as the
 *     inbox and the push, in the recipient's language, because it is the same
 *     notification arriving by a different door. What gets added is the chrome
 *     an email needs and a push has no room for: a button, why this arrived,
 *     and how to stop it.
 *   * **How to stop it.** One click, no login, no "manage preferences" page
 *     that asks who you are first. RFC 8058 requires the mailbox to be able to
 *     POST the unsubscribe URL itself, so that URL has to prove the address
 *     without a session — hence the signature rather than a bare `?email=`,
 *     which would let anybody unsubscribe anybody.
 *
 * `waves://` links are rewritten to the web-lite group page. A deep link is
 * exactly right on a phone and dead in desktop webmail, and the person reading
 * a settlement mail at a laptop is the one most likely to be at a laptop.
 */

import { renderNotification, type NotificationFacts } from './render';
import { copyFor, interpolate } from './copy';

/**
 * The templates that exist. TDR §7.3 names six; these are the three with
 * something that produces them today. The other three — `otp-login`,
 * `group-invite`, `export-ready` — have no caller: Supabase Auth sends its own
 * OTP mail, invites are links rather than addresses, and export hands back a
 * signed URL in the same response. Adding renderers for them now would be
 * three untested code paths waiting for a feature.
 */
export enum EmailTemplate {
  SettlementConfirm = 'settlement-confirm',
  Digest = 'digest',
  Nudge = 'nudge',
  GroupAdded = 'group-added',
  /**
   * A sign-in on a device this account has not used before. The only
   * *security* mail here, and it is shaped differently for that reason: no
   * unsubscribe line and no `List-Unsubscribe` header, because there is no such
   * thing as opting out of being told your account was opened somewhere.
   */
  NewDevice = 'new-device',
}

/**
 * Templates that are security notices rather than news. They carry the
 * security footer instead of the group one, and no way to unsubscribe.
 *
 * Bulk-mail rules are not being dodged here: `List-Unsubscribe` is required on
 * *bulk* mail, and a sign-in alert is transactional — the same class as a
 * password reset, which no sender offers an opt-out on either.
 */
const SECURITY_TEMPLATES: ReadonlySet<EmailTemplate> = new Set([EmailTemplate.NewDevice]);

export function isSecurityTemplate(template: EmailTemplate): boolean {
  return SECURITY_TEMPLATES.has(template);
}

/**
 * Which notification kinds leave the building as mail.
 *
 * Deliberately not `expense_added` and its neighbours. Routine ledger activity
 * is the inbox's job and the push's job; mailing it is the mistake that trains
 * people to filter the sender.
 *
 * `group_added` is the one exception worth a fallback: there is no in-app
 * inbox any more (#565) and no retry left once a push has exhausted itself, so
 * a push that never lands is the only way anybody learns they were put in a
 * group at all. Everything else on this list still degrades gracefully to
 * "check the app later"; this one does not.
 */
export const TEMPLATE_FOR_KIND: Readonly<Record<string, EmailTemplate>> = Object.assign(
  // Prototype-less: `kind` comes from a database row, and a value such as
  // `constructor` or `toString` would otherwise return an inherited function
  // instead of undefined.
  Object.create(null) as Record<string, EmailTemplate>,
  {
    settlement_initiated: EmailTemplate.SettlementConfirm,
    settlement_confirm_request: EmailTemplate.SettlementConfirm,
    digest_daily: EmailTemplate.Digest,
    /**
     * The weekly one is the digest that actually has a producer — a Monday
     * morning cron (`waves_enqueue_weekly_digest`). Same template, because a
     * digest is a digest whatever its cadence.
     */
    digest_weekly: EmailTemplate.Digest,
    /**
     * Mailed every time, unconditionally: no push check, and it survives the
     * "email me" preference (see `waves_claim_email_notifications`). Somebody
     * whose account was taken needs the mail most when they are least likely to
     * be holding the phone that got the push.
     */
    new_device_login: EmailTemplate.NewDevice,
    /**
     * A nudge is mailed only when the person has no live device — TDR §7.4. That
     * condition is not checked here; it is checked in SQL, where the tokens are.
     */
    nudge: EmailTemplate.Nudge,
    /**
     * Same rule as a nudge — mailed only when there is no live device to push
     * to, or the push has exhausted its retries — checked in SQL alongside the
     * other one, not here.
     */
    group_added: EmailTemplate.GroupAdded,
  },
);

export function templateForKind(kind: string): EmailTemplate | null {
  return TEMPLATE_FOR_KIND[kind] ?? null;
}

/** Languages written right to left. Only the layout changes; the copy is copy. */
const RIGHT_TO_LEFT = new Set(['ar', 'he', 'fa', 'ur']);

export interface EmailableNotification {
  readonly id: string;
  readonly kind: string;
  /** English fallback stored on the row, used when the kind is unknown here. */
  readonly title: string;
  readonly body: string;
  readonly deepLink?: string | null;
  readonly facts?: NotificationFacts;
  readonly locale?: string | null;
  /** The recipient's address, already checked against the suppression list. */
  readonly to: string;
  /** Shown in the footer so the reason for the mail is on the mail. */
  readonly groupName?: string | null;
}

export interface BuiltEmail {
  readonly notificationId: string;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly template: EmailTemplate;
  /**
   * `List-Unsubscribe` and its one-click partner. Gmail and Yahoo require both
   * on bulk mail, and a sender without them lands in spam whatever the content
   * says.
   */
  readonly headers: Readonly<Record<string, string>>;
}

export interface EmailOptions {
  /**
   * Base URL where web-lite is served — `EMAIL_WEB_URL` in the edge function
   * (see `emailWebUrl()`), which defaults to the site's real domain when
   * *unset* but falls back to nothing when set to an *explicit empty
   * string*. Either `null` or `''` here falls back to the `waves://` deep
   * link, which works on the phone and does nothing in
   * desktop webmail. A dead `https://` link would be worse — it looks like
   * it should work.
   */
  readonly webUrl?: string | null;
  /** Signed, address-specific, and safe to POST without a session. */
  readonly unsubscribeUrl: string;
  /**
   * When the mail is built — the sign-in alert's "Time" row. The fanout runs
   * every few minutes, so this is within minutes of the sign-in itself.
   * Injectable so a test can pin it.
   */
  readonly now?: Date;
}

/**
 * `waves://group/<id>/expense/<id>` becomes `<web>/g/<id>`.
 *
 * The trailing segments are dropped rather than translated: web-lite has a
 * group page and no expense page, and landing somebody on the group they were
 * told about beats landing them on a 404 that proves the mail was right.
 *
 * With no web URL configured the deep link is handed back untouched, and with
 * neither, there is no button — an email is still worth sending for what it
 * says.
 */
// `waves://` is the app's only scheme, and the one the DB functions write into
// `notifications.deep_link`. Anything else is not a link this rewriter will
// hand to a mail client.
const SAFE_LINK = /^(?:waves:\/\/|https?:\/\/)/i;

export function webLinkFor(
  deepLink: string | null | undefined,
  webUrl?: string | null,
): string | null {
  // deepLink comes from a stored row; a `javascript:` or `data:` scheme reaches
  // an href in any web preview of this HTML. Only known schemes survive.
  const safeDeepLink = deepLink && SAFE_LINK.test(deepLink) ? deepLink : null;
  if (!webUrl) return safeDeepLink;

  // webUrl is the href base for the email button; a non-HTTP(S) scheme
  // (`javascript:`, `data:`) would reach an href in any web preview. Only
  // valid HTTP(S) origins survive; anything else falls back to the deep link.
  let parsed: URL;
  try {
    parsed = new URL(webUrl);
  } catch {
    return safeDeepLink;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return safeDeepLink;

  const base = webUrl.replace(/\/+$/, '');
  if (!safeDeepLink) return base;
  if (safeDeepLink.startsWith('http://') || safeDeepLink.startsWith('https://'))
    return safeDeepLink;

  const group = /^waves:\/\/group\/([0-9a-fA-F-]{36})/.exec(safeDeepLink);
  return group ? `${base}/g/${group[1]}` : base;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildEmail(row: EmailableNotification, options: EmailOptions): BuiltEmail | null {
  const template = templateForKind(row.kind);
  if (!template) return null;

  const locale = row.locale ?? 'en';
  const language = locale.slice(0, 2).toLowerCase();
  const copy = copyFor(locale);
  const { title, body } = renderNotification(row.kind, row.facts ?? {}, locale, {
    title: row.title,
    body: row.body,
  });

  const security = isSecurityTemplate(template);
  const action = security
    ? copy.email.securityAction
    : template === 'settlement-confirm'
      ? copy.email.confirmAction
      : copy.email.openAction;
  const link = webLinkFor(row.deepLink, options.webUrl);
  // Why this arrived, and the answer is different for each shape of mail. A
  // digest summarises every group, so naming one is impossible; a security
  // notice is about the account, not a ledger. Only mail that *is* about a group
  // gets the group line — and when such a row reaches here with no group name
  // (`waves_notify` allows a null group), the honest fallback is "you use
  // Waves", not the app's own name dropped into the `{group}` slot, which read
  // as "You are getting this because of Waves on Waves."
  const why = security
    ? copy.email.securityReason
    : template === EmailTemplate.Digest
      ? copy.email.digestReason
      : row.groupName
        ? interpolate(copy.email.why, { group: row.groupName })
        : copy.email.promoReason;
  const direction = RIGHT_TO_LEFT.has(language) ? 'rtl' : 'ltr';

  if (security) {
    return buildSecurityEmail(row, template, {
      locale,
      direction,
      title,
      link,
      copy: copy.email,
      now: options.now ?? new Date(),
    });
  }

  return {
    notificationId: row.id,
    to: row.to,
    subject: title,
    html: renderHtml({
      direction,
      title,
      body,
      action,
      link,
      why,
      unsubscribe: security ? null : copy.email.unsubscribe,
      unsubscribeUrl: security ? null : options.unsubscribeUrl,
      signature: copy.email.signature,
    }),
    text: [
      title,
      '',
      body,
      '',
      link ?? '',
      '',
      why,
      security ? '' : `${copy.email.unsubscribe}: ${options.unsubscribeUrl}`,
    ]
      .join('\n')
      .trim(),
    template,
    headers: security
      ? {}
      : {
          'List-Unsubscribe': `<${options.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
  };
}

interface HtmlParts {
  readonly direction: 'ltr' | 'rtl';
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly link: string | null;
  readonly why: string;
  /** Both null on a security mail, which offers no way out. */
  readonly unsubscribe: string | null;
  readonly unsubscribeUrl: string | null;
  readonly signature: string;
}

/**
 * Deliberately plain, inline-styled and image-free.
 *
 * No remote images: a tracking pixel is what makes `opened` events possible and
 * also what makes a mail client hide the whole message behind "load images".
 * The webhook still reports opens when the reader's client fetches Resend's own
 * pixel; we do not add one of ours.
 */
function renderHtml(parts: HtmlParts): string {
  const align = parts.direction === 'rtl' ? 'right' : 'left';
  // A security mail has no unsubscribe line at all — not an empty one, and not
  // a dead link. Both halves arrive null together, so one check covers them.
  const optOut =
    parts.unsubscribe && parts.unsubscribeUrl
      ? `<br />
<a href="${escapeHtml(parts.unsubscribeUrl)}" style="color:#78716c;">${escapeHtml(parts.unsubscribe)}</a>`
      : '';
  const button = parts.link
    ? `<a href="${escapeHtml(parts.link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1c1917;color:#ffffff;text-decoration:none;font-size:15px;">${escapeHtml(parts.action)}</a>`
    : '';
  return `<!doctype html>
<html dir="${parts.direction}">
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;text-align:${align};">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;color:#1c1917;">${escapeHtml(parts.title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#44403c;">${escapeHtml(parts.body)}</p>
${button}
<p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#78716c;">${escapeHtml(parts.why)}${optOut}</p>
</div>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#a8a29e;text-align:${align};">${escapeHtml(parts.signature)}</p>
</body>
</html>`;
}

// ──────────────────────────────────────────────────── the sign-in alert ──

/** How the platform the app reports (`Platform.OS`) is written for a person. */
const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  android: 'Android',
  ios: 'iOS',
  ipados: 'iPadOS',
  web: 'Web',
  macos: 'macOS',
  windows: 'Windows',
};

/**
 * `waves_register_device` writes the device fact as `label · platform`
 * ("Pixel 9 · android"). The mail shows the two on separate rows, so they are
 * split back apart here; a fact without the separator is all label.
 */
export function splitDeviceFact(fact: string | undefined): {
  readonly label: string;
  readonly platform: string | null;
} {
  const value = (fact ?? '').trim();
  const at = value.lastIndexOf(' · ');
  if (at < 0) return { label: value, platform: null };
  const raw = value.slice(at + 3).trim();
  return {
    label: value.slice(0, at).trim(),
    // Own keys only: the platform is whatever a client sent, and `constructor`
    // or `__proto__` would otherwise find something on Object's prototype.
    platform: raw
      ? Object.hasOwn(PLATFORM_NAMES, raw.toLowerCase())
        ? PLATFORM_NAMES[raw.toLowerCase()]!
        : raw
      : null,
  };
}

/**
 * The time row. UTC and said so: the sender knows nothing about where the
 * reader is, and a time in an unnamed zone is one somebody checks against
 * their own clock and wrongly decides was not them.
 */
function signInTime(now: Date, locale: string): string {
  try {
    return `${new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(now)} UTC`;
  } catch {
    return `${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }
}

interface SecurityParts {
  readonly locale: string;
  readonly direction: 'ltr' | 'rtl';
  readonly title: string;
  readonly link: string | null;
  readonly copy: ReturnType<typeof copyFor>['email'];
  readonly now: Date;
}

/** Stands in for the device in the headline until it is safe to add markup. */
const DEVICE_SLOT = '\u0000device\u0000';

function buildSecurityEmail(
  row: EmailableNotification,
  template: EmailTemplate,
  parts: SecurityParts,
): BuiltEmail {
  const { copy } = parts;
  const { label, platform } = splitDeviceFact(row.facts?.device);
  const time = signInTime(parts.now, parts.locale);
  const named = platform ? `${label} - ${platform}` : label;
  // The subject says the device the way the headline does, rather than the
  // raw fact's "Pixel 9 · android".
  const subject = row.facts?.device
    ? renderNotification(row.kind, { ...row.facts, device: named }, parts.locale, {
        title: row.title,
        body: row.body,
      }).title
    : parts.title;

  // The headline is the translated title with the device dropped in, and the
  // platform in the brand colour. It is rendered with a placeholder, escaped,
  // and only then given its markup — so no device name can carry HTML in.
  const headline = renderNotification(
    row.kind,
    { ...row.facts, device: DEVICE_SLOT },
    parts.locale,
    { title: row.title, body: row.body },
  ).title;
  const deviceHtml = platform
    ? `${escapeHtml(label)} - <span style="color:${BRAND};">${escapeHtml(platform)}</span>`
    : escapeHtml(label);
  const headlineHtml = headline.includes(DEVICE_SLOT)
    ? escapeHtml(headline).replace(DEVICE_SLOT, deviceHtml)
    : escapeHtml(parts.title);

  const details: { icon: string; label: string; value: string }[] = [
    { icon: '&#128241;', label: copy.securityDevice, value: label },
    ...(platform ? [{ icon: '&#9881;&#65039;', label: copy.securitySystem, value: platform }] : []),
    { icon: '&#128339;', label: copy.securityTime, value: time },
  ];

  return {
    notificationId: row.id,
    to: row.to,
    subject,
    html: renderSecurityHtml({
      direction: parts.direction,
      badge: copy.securityBadge,
      headlineHtml,
      lead: copy.securityLead,
      details,
      action: copy.securityAction,
      link: parts.link,
      manage: copy.securityManage,
      why: copy.securityReason,
      signature: copy.signature,
      platform,
    }),
    text: [
      subject,
      '',
      copy.securityLead,
      '',
      ...details.map((detail) => `${detail.label}: ${detail.value}`),
      '',
      parts.link ? `${copy.securityAction}: ${parts.link}` : '',
      '',
      copy.securityManage,
      copy.securityReason,
    ]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    template,
    // No `List-Unsubscribe`: see `SECURITY_TEMPLATES`.
    headers: {},
  };
}

/** The Waves brand violet (`gradients.light[1]` in @waves/ui). */
const BRAND = '#5B3FD1';

interface SecurityHtml {
  readonly direction: 'ltr' | 'rtl';
  readonly badge: string;
  /** Already escaped — it carries the platform's colour span. */
  readonly headlineHtml: string;
  readonly lead: string;
  readonly details: readonly { icon: string; label: string; value: string }[];
  readonly action: string;
  readonly link: string | null;
  readonly manage: string;
  readonly why: string;
  readonly signature: string;
  readonly platform: string | null;
}

/**
 * The sign-in alert's own layout: a badge, a large headline, the facts as a
 * list, one dark button, and a phone drawn beside it.
 *
 * Built from tables and inline styles because that is what mail clients
 * render; the phone is CSS, not an image, for the same no-remote-images reason
 * as `renderHtml`. On a narrow screen the phone column drops away
 * (`.waves-art`) and the text takes the full width — clients that ignore the
 * media query simply keep both columns.
 */
function renderSecurityHtml(parts: SecurityHtml): string {
  const align = parts.direction === 'rtl' ? 'right' : 'left';
  const rows = parts.details
    .map(
      (detail) => `<tr>
<td width="40" valign="top" style="padding:10px 0;font-size:20px;line-height:24px;">${detail.icon}</td>
<td valign="top" style="padding:10px 0;">
<div style="font-size:15px;font-weight:700;color:#1c1917;line-height:20px;">${escapeHtml(detail.label)}</div>
<div style="font-size:15px;color:#57534e;line-height:22px;">${escapeHtml(detail.value)}</div>
</td>
</tr>`,
    )
    .join('\n');
  const button = parts.link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;"><tr><td style="border-radius:999px;background:#1c1917;">
<a href="${escapeHtml(parts.link)}" style="display:inline-block;padding:15px 36px;border-radius:999px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;">${escapeHtml(parts.action)} &rarr;</a>
</td></tr></table>`
    : '';
  const phone = `<td class="waves-art" width="190" valign="middle" align="center" style="padding:0 0 0 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-radius:110px;background:#ede9fe;padding:28px;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="112" style="width:112px;border:6px solid #1c1917;border-radius:24px;background:#f5f3ff;"><tr>
<td align="center" valign="middle" height="190" style="height:190px;font-family:inherit;">
<div style="font-size:22px;font-weight:800;color:${BRAND};letter-spacing:-0.5px;">Waves</div>
${parts.platform ? `<div style="font-size:15px;font-weight:700;color:#1c1917;margin-top:6px;">${escapeHtml(parts.platform)}</div>` : ''}
<div style="margin:16px auto 0;width:44px;height:44px;line-height:44px;border-radius:22px;background:${BRAND};color:#ffffff;font-size:24px;font-weight:700;text-align:center;">&#10003;</div>
</td></tr></table>
</td></tr></table>
</td>`;

  return `<!doctype html>
<html dir="${parts.direction}">
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
@media (max-width: 600px) { .waves-art { display: none !important; } .waves-card { padding: 24px !important; } .waves-h1 { font-size: 26px !important; } }
</style>
</head>
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;margin:0 auto;">
<tr><td style="padding:0 8px 16px;text-align:${align};font-size:26px;font-weight:800;color:${BRAND};letter-spacing:-0.5px;">Waves</td></tr>
<tr><td class="waves-card" style="background:#ffffff;border-radius:20px;padding:36px 40px;text-align:${align};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
<td valign="top">
<span style="display:inline-block;padding:6px 14px;border-radius:999px;background:#ede9fe;color:${BRAND};font-size:13px;font-weight:600;">&#128737;&#65039; ${escapeHtml(parts.badge)}</span>
<h1 class="waves-h1" style="margin:18px 0 12px;font-size:32px;line-height:1.2;font-weight:800;color:#1c1917;">${parts.headlineHtml}</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#57534e;">${escapeHtml(parts.lead)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e7e5e4;margin:0 0 20px;">
${rows}
</table>
${button}
</td>
${phone}
</tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#78716c;">${escapeHtml(parts.manage)}<br />${escapeHtml(parts.why)}</p>
</td></tr>
<tr><td style="padding:16px 8px 0;font-size:12px;color:#a8a29e;text-align:${align};">${escapeHtml(parts.signature)}</td></tr>
</table>
</body>
</html>`;
}

// ─────────────────────────────────────────────── one-click unsubscribe ──

/**
 * A signature over the address, so the unsubscribe URL proves who it is for.
 *
 * RFC 8058 has the mail client POST this URL unattended — no cookie, no login,
 * no confirmation page. Without a signature the parameter would be a plain
 * address, and unsubscribing somebody else would be a matter of editing a query
 * string.
 */
export async function signUnsubscribe(address: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(normaliseAddress(address)),
  );
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyUnsubscribe(
  address: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  // Constant time: comparing with `===` leaks where the first byte differs, and
  // this endpoint is unauthenticated by design.
  return constantTimeEquals(await signUnsubscribe(address, secret), signature);
}

/** Lower-cased and trimmed — the same address, however it was typed. */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function unsubscribeUrlFor(
  functionsUrl: string,
  address: string,
  signature: string,
): string {
  const base = functionsUrl.replace(/\/+$/, '');
  const query = new URLSearchParams({ address: normaliseAddress(address), sig: signature });
  return `${base}/email-unsubscribe?${query.toString()}`;
}

// ────────────────────────────────────────────────── the webhook signature ──

/**
 * Svix's scheme, which is what Resend signs its webhooks with.
 *
 * This lives here rather than in the edge function for one reason: it is the
 * entire security of an endpoint anybody on the internet can reach, and getting
 * it subtly wrong fails in the direction nobody notices. Every delivery report
 * is answered 401, Resend gives up after a while, and the suppression list
 * quietly freezes at whatever it happened to hold — no error, no alert, just
 * mail going to addresses that bounced last month. Here it is checked in CI
 * against Svix's published test vector.
 *
 * HMAC-SHA256 over `id.timestamp.body`, keyed with the secret after `whsec_` is
 * stripped and the rest base64-decoded.
 */
export interface WebhookSignatureCheck {
  readonly secret: string;
  readonly id: string;
  readonly timestamp: string;
  /** The raw body text. `JSON.stringify(JSON.parse(body))` is a different string. */
  readonly body: string;
  /** The `svix-signature` header, verbatim. */
  readonly header: string;
  /** Seconds since the epoch. Injectable so the tolerance can be tested. */
  readonly now?: number;
  readonly toleranceSeconds?: number;
}

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export async function verifyWebhookSignature(check: WebhookSignatureCheck): Promise<boolean> {
  const sent = Number(check.timestamp);
  if (!check.timestamp || !Number.isFinite(sent)) return false;

  // Replay protection. Without it a signature stays valid forever, and a body
  // captured once could be posted back at any time.
  const now = check.now ?? Math.floor(Date.now() / 1000);
  const tolerance = check.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - sent) > tolerance) return false;

  const raw = check.secret.startsWith('whsec_')
    ? check.secret.slice('whsec_'.length)
    : check.secret;
  let expected: string;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      base64ToBuffer(raw),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    expected = bytesToBase64(
      new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          key,
          new TextEncoder().encode(`${check.id}.${check.timestamp}.${check.body}`),
        ),
      ),
    );
  } catch {
    // A secret that is not base64 is a misconfiguration, and the safe reading of
    // a signature check that cannot run is that nothing verifies.
    return false;
  }

  // The header may carry several space-separated versioned signatures, because
  // a secret mid-rotation means two are valid at once. Any one matching is a
  // pass; reading only the first would break every rotation.
  for (const part of check.header.split(' ')) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) continue;
    if (constantTimeEquals(value, expected)) return true;
  }
  return false;
}

/**
 * Returns the buffer rather than the view. `new Uint8Array(n)` is typed over
 * `ArrayBufferLike`, which could be a `SharedArrayBuffer`, and `importKey` will
 * not take one — so the allocation is made explicit and the `ArrayBuffer` is
 * what leaves.
 */
function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
