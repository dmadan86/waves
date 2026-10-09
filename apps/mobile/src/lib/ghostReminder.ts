/**
 * Reminding someone who is not on Waves yet.
 *
 * The in-app nudge is a push notification, so it needs an account. A member
 * somebody typed in by name ("ghost") has none — but often has the phone or
 * email they were added with (`invite_phone`, E.164, and `invite_email`). The
 * reminder goes out over that instead, from the user's own WhatsApp, SMS or
 * mail app, and carries the group's join link so it doubles as an invite.
 *
 * Pure: the screens open the URLs in `ghostReminderPlan` in order and fall back
 * to the system share sheet when none of them opens.
 */

/** How a reminder to someone not on Waves leaves the app. */
export enum GhostChannel {
  WhatsApp = 'whatsapp',
  Email = 'email',
  Share = 'share',
}

export interface GhostContact {
  readonly phone?: string | null;
  readonly email?: string | null;
}

/** The digits of a phone number, as WhatsApp and wa.me want it: no `+`, no spaces. */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

function cleanEmail(email: string | null | undefined): string {
  const trimmed = (email ?? '').trim();
  return trimmed.includes('@') ? trimmed : '';
}

/** A phone wins over an email; with neither, the share sheet. */
export function ghostChannel(contact: GhostContact): GhostChannel {
  if (phoneDigits(contact.phone)) return GhostChannel.WhatsApp;
  if (cleanEmail(contact.email)) return GhostChannel.Email;
  return GhostChannel.Share;
}

/** Fill `{name}`, `{amount}`, `{group}` and `{link}` in a localized template. */
export function ghostReminderMessage(
  template: string,
  values: { name: string; amount: string; group: string; link: string },
): string {
  return template
    .replace(/\{name\}/g, values.name)
    .replace(/\{amount\}/g, values.amount)
    .replace(/\{group\}/g, values.group)
    .replace(/\{link\}/g, values.link)
    .trim();
}

export function whatsappAppUrl(phone: string, text: string): string {
  return `whatsapp://send?phone=${phoneDigits(phone)}&text=${encodeURIComponent(text)}`;
}

export function whatsappWebUrl(phone: string, text: string): string {
  return `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(text)}`;
}

/** iOS takes the body after `&`, Android after `?`. The `+` of E.164 is kept. */
export function smsUrl(phone: string, body: string, os: string): string {
  const number = (phone.trim().startsWith('+') ? '+' : '') + phoneDigits(phone);
  return `sms:${number}${os === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

export function mailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${email.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * The URLs to try, in order; the caller opens the first one that opens and
 * otherwise shows the share sheet with `message`.
 *
 * With a phone: the WhatsApp app first. On Android a phone without WhatsApp
 * goes to SMS next (wa.me would only open a download page in the browser); on
 * iOS wa.me is the universal link that still lands in WhatsApp, with SMS after.
 * With only an email: the mail app.
 */
export function ghostReminderPlan(
  contact: GhostContact,
  message: string,
  subject: string,
  os: string,
): string[] {
  const channel = ghostChannel(contact);
  if (channel === GhostChannel.WhatsApp) {
    const phone = contact.phone as string;
    const app = whatsappAppUrl(phone, message);
    const web = whatsappWebUrl(phone, message);
    const sms = smsUrl(phone, message, os);
    return os === 'android' ? [app, sms, web] : [app, web, sms];
  }
  if (channel === GhostChannel.Email) {
    return [mailtoUrl(cleanEmail(contact.email), subject, message)];
  }
  return [];
}
