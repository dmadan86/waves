/**
 * Push text for couple and family spaces: no amounts, descriptions or notes.
 * A lock screen is read by whoever holds the phone, and in a shared space that
 * is often the other person. The inbox inside the app still shows everything;
 * only what leaves the server for the lock screen is made generic.
 */

import { copyFor, interpolate, NotificationKind } from './copy';
import { renderNotification, type NotificationFacts, type RenderedNotification } from './render';

/** Group types whose notifications stay generic: couple, and home (the family space). */
export function isPrivateSpaceType(type: string | null | undefined): boolean {
  return type === 'couple' || type === 'home';
}

type Shape = 'added' | 'changed' | 'activity';

const GENERIC: { en: Record<Shape | 'body', string> } & Record<
  string,
  Record<Shape | 'body', string>
> = {
  en: {
    added: '{actor} added an expense in {group}',
    changed: '{actor} updated an expense in {group}',
    activity: 'New activity in {group}',
    body: 'Tap to open Waves',
  },
  ta: {
    added: '{actor} {group}-ல் ஒரு செலவைச் சேர்த்தார்',
    changed: '{actor} {group}-ல் ஒரு செலவை மாற்றினார்',
    activity: '{group}-ல் புதிய செயல்',
    body: 'Waves-ஐத் திறக்கத் தட்டவும்',
  },
  hi: {
    added: '{actor} ने {group} में एक खर्च जोड़ा',
    changed: '{actor} ने {group} में एक खर्च बदला',
    activity: '{group} में नई गतिविधि',
    body: 'Waves खोलने के लिए टैप करें',
  },
  ar: {
    added: '{actor} أضاف مصروفًا في {group}',
    changed: '{actor} عدّل مصروفًا في {group}',
    activity: 'نشاط جديد في {group}',
    body: 'اضغط لفتح Waves',
  },
};

const CHANGED: ReadonlySet<string> = new Set([
  NotificationKind.ExpenseEdited,
  NotificationKind.ExpenseDeleted,
  NotificationKind.ExpenseDisputed,
  NotificationKind.ExpenseDisputeResolved,
  NotificationKind.Resplit,
  NotificationKind.GroupImport,
]);

/**
 * Like `renderNotification`, but a kind whose wording carries an amount or a
 * description gets the generic sentence instead. Other kinds render normally
 * with those two facts stripped.
 */
export function renderPrivateNotification(
  kind: string,
  facts: NotificationFacts,
  locale: string,
  fallback?: RenderedNotification,
): RenderedNotification {
  const stripped: NotificationFacts = { ...facts, amount: undefined, description: undefined };
  const template = copyFor(locale).notifications[kind as NotificationKind];
  // An unknown kind only has the stored English row, which may hold the amount.
  if (!template) return { title: kind, body: '' };
  if (!/\{(amount|amountOf|description)\}/.test(template.title + template.body)) {
    return renderNotification(kind, stripped, locale, fallback);
  }
  const words = GENERIC[locale] ?? GENERIC.en;
  const shape: Shape =
    kind === NotificationKind.ExpenseAdded && facts.counterparty
      ? 'added'
      : CHANGED.has(kind) && facts.counterparty
        ? 'changed'
        : 'activity';
  const group = facts.group?.trim() || copyFor(locale).notificationFallbacks.group;
  return {
    title: interpolate(words[shape], { actor: facts.counterparty ?? '', group }),
    body: words.body,
  };
}
