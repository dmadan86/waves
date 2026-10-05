/**
 * The small tag a group wears wherever it is listed: "Trip", "Home",
 * "Couple"… and, for an Event group, the kind of event ("Wedding", "Birthday")
 * rather than the bare word "Event".
 *
 * Pure so the mapping is testable without React: it takes the strings it needs
 * and returns what to draw. A group typed `other`, or carrying no/unknown type,
 * gets no tag — "Other" says nothing a reader can use. An Event whose template
 * is unset or `other` falls back to the generic "Event" label.
 */

import type { EventTemplateId } from '@waves/core';

import { GroupType } from '@/data/types';

export interface GroupTypeTag {
  /** The group's real type — the caller picks the icon off it. */
  readonly type: GroupType;
  /** Short word: "Trip", "Wedding"… */
  readonly label: string;
}

export interface GroupTypeTagLabels {
  /** Per-type words — `t.extras` carries these as typeTrip, typeHome… */
  readonly types: Readonly<Record<Exclude<GroupType, GroupType.Other>, string>>;
  /** Per event-template short words. */
  readonly events: Readonly<Record<EventTemplateId, string>>;
}

const KNOWN_TEMPLATES: ReadonlySet<string> = new Set([
  'wedding_in',
  'wedding_west',
  'birthday',
  'other',
]);

export function groupTypeTag(
  type: string | null | undefined,
  eventTemplate: string | null | undefined,
  labels: GroupTypeTagLabels,
): GroupTypeTag | null {
  switch (type) {
    case GroupType.Trip:
    case GroupType.Home:
    case GroupType.Couple:
    case GroupType.Friends:
      return { type, label: labels.types[type] };
    case GroupType.Event: {
      const template =
        eventTemplate && KNOWN_TEMPLATES.has(eventTemplate)
          ? (eventTemplate as EventTemplateId)
          : null;
      return {
        type: GroupType.Event,
        label: template && template !== 'other' ? labels.events[template] : labels.types.event,
      };
    }
    default:
      return null;
  }
}
