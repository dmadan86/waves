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
  /** Short word: "Trip", "Wedding"… or the member's own tag. */
  readonly label: string;
  /** True when `label` is the member's own tag rather than the automatic one. */
  readonly custom: boolean;
}

/** Longest custom tag — the same number as the `groups_custom_tag_shape` CHECK
 *  (supabase migration 20261006120000_group_custom_tag). */
export const GROUP_TAG_MAX = 24;

/**
 * A typed tag as the column should hold it: whitespace collapsed and trimmed,
 * capped at GROUP_TAG_MAX characters, and NULL rather than empty.
 */
export function normaliseGroupTag(raw: string | null | undefined): string | null {
  const collapsed = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return Array.from(collapsed).slice(0, GROUP_TAG_MAX).join('').trim() || null;
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
  customTag?: string | null,
): GroupTypeTag | null {
  // The member's own word wins over the automatic one: one pill, never two. It
  // also shows on an "other" group, which has no automatic tag at all.
  const custom = normaliseGroupTag(customTag);
  if (custom) {
    const known = Object.values(GroupType).includes(type as GroupType);
    return { type: known ? (type as GroupType) : GroupType.Other, label: custom, custom: true };
  }
  switch (type) {
    case GroupType.Trip:
    case GroupType.Home:
    case GroupType.Couple:
    case GroupType.Friends:
      return { type, label: labels.types[type], custom: false };
    case GroupType.Event: {
      const template =
        eventTemplate && KNOWN_TEMPLATES.has(eventTemplate)
          ? (eventTemplate as EventTemplateId)
          : null;
      return {
        type: GroupType.Event,
        label: template && template !== 'other' ? labels.events[template] : labels.types.event,
        custom: false,
      };
    }
    default:
      return null;
  }
}
