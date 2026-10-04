/**
 * Event templates (`event-organizer.md`): the fixed sub-event list an Event
 * group offers once somebody picks what kind of event it is — a wedding has
 * ceremonies before the wedding itself; a birthday does not, and its "sub-
 * events" are really just the spend areas somebody budgets for.
 *
 * Deliberately not stored per-group. `groups.event_template` is one id; this
 * table is the same for every group with that id, so renaming or re-ordering
 * a template's sub-events in a later release reaches every group that picked
 * it, the same way a built-in category's label is never copied onto a row.
 * Display labels live in the app's i18n strings, keyed by each id below —
 * this module only knows ids and emoji, never English text (ADR-010-adjacent:
 * `@waves/core` is locale-free).
 *
 * A sub-event id doubles as a key into the group's existing `category_budgets`
 * map (TDR §8 / `waves_set_category_budget`): "Event budget" reuses the
 * per-category budget machinery wholesale rather than inventing a parallel
 * admin-set, group-visible, synced map for a second time. {@link
 * spendBySubEvent} in `./budget` is the only new maths this needs.
 */

/** The four templates offered when starting an Event group. 'other' carries no
 *  sub-events — the escape hatch for an event this list does not fit. */
export type EventTemplateId = 'wedding_in' | 'wedding_west' | 'birthday' | 'other';

/** One sub-event a template suggests. */
export interface EventSubEventDef {
  /** Stable id — a translation key (`t.eventSubEvents[id]`) and the value
   *  `subEventId` carries on a tagged expense. Never renamed once shipped. */
  readonly id: string;
  /** A single emoji for the compact chip row; no icon set lookup needed. */
  readonly emoji: string;
}

/** One event template: its id and the sub-events it suggests, in display order. */
export interface EventTemplateDef {
  readonly id: EventTemplateId;
  readonly subEvents: readonly EventSubEventDef[];
}

/**
 * The templates, in the order offered. An Indian wedding gets the pre-wedding
 * functions (engagement through haldi) ahead of the wedding and reception,
 * reflecting how the money is actually planned there — a budget spreadsheet
 * or WedMeGood's own planner breaks a wedding down the same way. A Western
 * wedding's list is shorter: engagement, one bachelor/bachelorette night,
 * the rehearsal dinner, the ceremony, the reception. A birthday has no
 * ceremonies to speak of, so its "sub-events" are the spend areas a parent or
 * host actually budgets for.
 */
export const EVENT_TEMPLATES: readonly EventTemplateDef[] = [
  {
    id: 'wedding_in',
    subEvents: [
      { id: 'engagement', emoji: '💍' },
      { id: 'mehendi', emoji: '🌿' },
      { id: 'haldi', emoji: '🌼' },
      { id: 'sangeet', emoji: '🎶' },
      { id: 'wedding', emoji: '💐' },
      { id: 'reception', emoji: '🥂' },
    ],
  },
  {
    id: 'wedding_west',
    subEvents: [
      { id: 'engagement', emoji: '💍' },
      { id: 'bachelor_party', emoji: '🎉' },
      { id: 'rehearsal_dinner', emoji: '🍽️' },
      { id: 'ceremony', emoji: '💐' },
      { id: 'reception', emoji: '🥂' },
    ],
  },
  {
    id: 'birthday',
    subEvents: [
      { id: 'venue_decor', emoji: '🎈' },
      { id: 'catering', emoji: '🍰' },
      { id: 'entertainment', emoji: '🎤' },
      { id: 'favors', emoji: '🎁' },
    ],
  },
  {
    id: 'other',
    subEvents: [],
  },
];

/** A template by id, or null for an unknown/omitted one — never throws, so a
 *  group made by a newer client with a template this build does not know
 *  simply shows no sub-event chips instead of crashing. */
export function eventTemplateById(id: string | null | undefined): EventTemplateDef | null {
  if (!id) return null;
  return EVENT_TEMPLATES.find((template) => template.id === id) ?? null;
}

/** The sub-events a group's `eventTemplate` suggests; an empty list for 'other',
 *  for an unknown id and for no template at all. */
export function subEventsForTemplate(id: string | null | undefined): readonly EventSubEventDef[] {
  return eventTemplateById(id)?.subEvents ?? [];
}
