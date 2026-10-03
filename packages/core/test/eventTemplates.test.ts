/**
 * Event templates (`event-organizer.md`): fixed, locale-free data — the
 * lookups must never throw on an id this build does not know, because an
 * older client has to open a group a newer one made with a template it has
 * never heard of.
 */

import { describe, expect, it } from 'vitest';

import {
  EVENT_TEMPLATES,
  eventTemplateById,
  subEventsForTemplate,
} from '../src/trip/eventTemplates';

describe('EVENT_TEMPLATES', () => {
  it('offers exactly the four templates, each with a stable id', () => {
    expect(EVENT_TEMPLATES.map((template) => template.id)).toEqual([
      'wedding_in',
      'wedding_west',
      'birthday',
      'other',
    ]);
  });

  it('gives every sub-event a non-empty id and a single emoji', () => {
    for (const template of EVENT_TEMPLATES) {
      for (const subEvent of template.subEvents) {
        expect(subEvent.id.length).toBeGreaterThan(0);
        expect(subEvent.emoji.length).toBeGreaterThan(0);
      }
    }
  });

  it('never repeats a sub-event id within one template', () => {
    for (const template of EVENT_TEMPLATES) {
      const ids = template.subEvents.map((subEvent) => subEvent.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('leaves "other" with no suggested sub-events — the escape hatch', () => {
    expect(subEventsForTemplate('other')).toEqual([]);
  });
});

describe('eventTemplateById', () => {
  it('finds a known template', () => {
    expect(eventTemplateById('wedding_in')?.subEvents.map((s) => s.id)).toEqual([
      'engagement',
      'mehendi',
      'haldi',
      'sangeet',
      'wedding',
      'reception',
    ]);
  });

  it('returns null for null, undefined and an unknown id — never throws', () => {
    expect(eventTemplateById(null)).toBeNull();
    expect(eventTemplateById(undefined)).toBeNull();
    expect(eventTemplateById('not-a-template')).toBeNull();
  });
});

describe('subEventsForTemplate', () => {
  it('is the empty list for every input eventTemplateById would refuse', () => {
    expect(subEventsForTemplate(null)).toEqual([]);
    expect(subEventsForTemplate('unknown')).toEqual([]);
  });

  it('matches the template’s own sub-events for a known id', () => {
    expect(subEventsForTemplate('birthday')).toEqual(
      EVENT_TEMPLATES.find((t) => t.id === 'birthday')?.subEvents,
    );
  });
});
