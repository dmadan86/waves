/**
 * The operator's messages, and the one thing they may never do.
 *
 * Two properties get the most tests here, because they are the two that would
 * hurt somebody:
 *
 *   1. **Fail open.** No config, a broken config, a config from the future —
 *      every one of them has to come out silent. A gate that fired on a failed
 *      fetch would lock people out of their own ledger during exactly the
 *      outage it existed to describe.
 *   2. **No notice ever gates.** Maintenance, an incident, an announcement: all
 *      three may take the banner and none of them may take the app. The test
 *      sweeps every kind against every phase and asserts it.
 */

import { describe, expect, it } from 'vitest';

import { appState, AppGate, NoticeKind, NoticePhase, UpdateDecision } from '../src/index';

const NOW = Date.parse('2026-09-12T12:00:00Z');
const HOUR = 3_600_000;

const release = (latest: string, minimum: string) => ({
  platform: 'android',
  latest_version: latest,
  minimum_version: minimum,
  store_url: 'https://play.google.com/store/apps/details?id=app.waves.mobile',
  message: null,
});

const base = {
  installedVersion: '1.4.0',
  platform: 'android' as const,
  now: NOW,
  locale: 'en',
};

const maintenance = (from: number, to: number) => ({
  id: 'm1',
  kind: 'maintenance',
  starts_at: new Date(from).toISOString(),
  ends_at: new Date(to).toISOString(),
  visible_from: new Date(from - 24 * HOUR).toISOString(),
  visible_until: null,
  platforms: null,
  countries: null,
  body: {},
});

describe('failing open', () => {
  it('says nothing when there is no config at all', () => {
    const view = appState({ ...base });
    expect(view.gate).toBe(AppGate.None);
    expect(view.banner).toBeNull();
    expect(view.notices).toEqual([]);
  });

  it('says nothing when the fetch came back as junk', () => {
    for (const junk of [null, 0, '', 'nope', [], {}, { latest_version: 7 }, NaN]) {
      const view = appState({ ...base, release: junk, notices: junk });
      expect(view.gate, JSON.stringify(junk)).toBe(AppGate.None);
      expect(view.banner, JSON.stringify(junk)).toBeNull();
    }
  });

  it('drops a single malformed notice without losing the good one beside it', () => {
    const view = appState({
      ...base,
      notices: [
        null,
        'a string',
        { id: 'no-kind' },
        { id: 'x', kind: 'something-invented-later' },
        maintenance(NOW - HOUR, NOW + HOUR),
      ],
    });
    expect(view.notices).toHaveLength(1);
    expect(view.notices[0]?.id).toBe('m1');
  });

  it('does not gate on a version string it cannot parse', () => {
    const view = appState({
      ...base,
      installedVersion: '1.4.0-rc2',
      release: release('2.0.0', '2.0.0'),
    });
    expect(view.gate).toBe(AppGate.None);
  });

  it('ignores a minimum above every build that exists — the operator typo', () => {
    // Stopped in the database by a CHECK and in the admin console by a
    // confirmation, and stopped a third time here: if one ever gets through,
    // it must not strand the install base.
    const view = appState({ ...base, release: release('1.4.0', '99.0.0') });
    expect(view.gate).toBe(AppGate.None);
  });
});

describe('the update half', () => {
  it('suggests when something newer is out', () => {
    const view = appState({ ...base, release: release('1.5.0', '1.0.0') });
    expect(view.gate).toBe(AppGate.None);
    expect(view.banner).toMatchObject({
      channel: 'update',
      decision: UpdateDecision.Suggested,
      latestVersion: '1.5.0',
    });
  });

  it('stays quiet once that version has been waved away', () => {
    const view = appState({
      ...base,
      release: release('1.5.0', '1.0.0'),
      dismissedUpdateVersion: '1.5.0',
    });
    expect(view.banner).toBeNull();
  });

  it('comes back for the next version after a dismissal', () => {
    const view = appState({
      ...base,
      release: release('1.6.0', '1.0.0'),
      dismissedUpdateVersion: '1.5.0',
    });
    expect(view.banner).toMatchObject({ channel: 'update', latestVersion: '1.6.0' });
  });

  it('gates only below the minimum', () => {
    expect(appState({ ...base, release: release('2.0.0', '1.4.0') }).gate).toBe(AppGate.None);
    expect(appState({ ...base, release: release('2.0.0', '1.4.1') }).gate).toBe(
      AppGate.UpdateRequired,
    );
  });

  it('compares by segment, not by string, across a two-digit bump', () => {
    // `'1.10.0' < '1.9.0'` is true of strings and false of versions. Getting
    // this wrong strands everybody on 1.10 the day 1.9's minimum is set.
    const on110 = { ...base, installedVersion: '1.10.0' };
    expect(appState({ ...on110, release: release('1.10.0', '1.9.0') }).gate).toBe(AppGate.None);
    expect(appState({ ...on110, release: release('1.10.0', '1.9.0') }).banner).toBeNull();

    const on19 = { ...base, installedVersion: '1.9.0' };
    expect(appState({ ...on19, release: release('1.10.0', '1.10.0') }).gate).toBe(
      AppGate.UpdateRequired,
    );
  });

  it('does not gate on a platform with no store to send anybody to', () => {
    const view = appState({
      ...base,
      platform: 'web',
      release: release('2.0.0', '2.0.0'),
    });
    expect(view.gate).toBe(AppGate.None);
  });

  it("carries the wall's own message when the policy wrote one", () => {
    const view = appState({
      ...base,
      release: { ...release('2.0.0', '2.0.0'), message: 'Sync changed in 2.0.' },
    });
    expect(view.gate).toBe(AppGate.UpdateRequired);
    expect(view.gateText).toMatchObject({ text: 'Sync changed in 2.0.', matchesReader: true });
  });
});

describe('a maintenance window', () => {
  it('is silent before it is announced', () => {
    const view = appState({
      ...base,
      notices: [
        {
          ...maintenance(NOW + 48 * HOUR, NOW + 50 * HOUR),
          visible_from: new Date(NOW + 24 * HOUR).toISOString(),
        },
      ],
    });
    expect(view.notices).toEqual([]);
  });

  it('is upcoming once announced and before it starts', () => {
    const view = appState({ ...base, notices: [maintenance(NOW + 3 * HOUR, NOW + 5 * HOUR)] });
    expect(view.notices[0]).toMatchObject({
      kind: NoticeKind.Maintenance,
      phase: NoticePhase.Upcoming,
    });
    expect(view.banner).toMatchObject({ channel: 'notice', phase: NoticePhase.Upcoming });
  });

  it('is active between its start and its end', () => {
    const view = appState({ ...base, notices: [maintenance(NOW - HOUR, NOW + HOUR)] });
    expect(view.notices[0]).toMatchObject({ phase: NoticePhase.Active });
  });

  it('stops speaking once it has passed', () => {
    const view = appState({ ...base, notices: [maintenance(NOW - 5 * HOUR, NOW - HOUR)] });
    expect(view.notices).toEqual([]);
    expect(view.banner).toBeNull();
  });

  it('never disables ledger writes, in any phase, for any kind', () => {
    // The rule, swept. `AppGate` has no member a notice could produce, so this
    // is really a guard on a future edit adding one.
    const windows: readonly [number, number][] = [
      [NOW + 3 * HOUR, NOW + 5 * HOUR], // upcoming
      [NOW - HOUR, NOW + HOUR], // active
    ];
    for (const kind of Object.values(NoticeKind)) {
      for (const [from, to] of windows) {
        const view = appState({
          ...base,
          notices: [{ ...maintenance(from, to), kind, body: { en: 'Something is up.' } }],
        });
        expect(view.gate, `${kind} ${from}`).toBe(AppGate.None);
      }
    }
  });
});

describe('scoping', () => {
  const live = { ...maintenance(NOW - HOUR, NOW + HOUR), body: { en: 'Sync is paused.' } };

  it('reaches everybody when nothing is scoped', () => {
    expect(appState({ ...base, notices: [live] }).notices).toHaveLength(1);
  });

  it('honours a platform list', () => {
    expect(appState({ ...base, notices: [{ ...live, platforms: ['ios'] }] }).notices).toHaveLength(
      0,
    );
    expect(
      appState({ ...base, notices: [{ ...live, platforms: ['ios', 'android'] }] }).notices,
    ).toHaveLength(1);
  });

  it('honours a country list', () => {
    const inIndia = { ...base, country: 'IN' };
    expect(
      appState({ ...inIndia, notices: [{ ...live, countries: ['AE'] }] }).notices,
    ).toHaveLength(0);
    expect(
      appState({ ...inIndia, notices: [{ ...live, countries: ['in'] }] }).notices,
    ).toHaveLength(1);
  });

  it('leaves a device that does not know its country out of a country-scoped notice', () => {
    expect(
      appState({ ...base, country: null, notices: [{ ...live, countries: ['IN'] }] }).notices,
    ).toHaveLength(0);
  });

  it('treats an unreadable scope as unscoped rather than silently reaching nobody', () => {
    expect(
      appState({ ...base, notices: [{ ...live, platforms: 'android', countries: [] }] }).notices,
    ).toHaveLength(1);
  });
});

describe('severity', () => {
  const at = (kind: string, id: string, from: number, to: number) => ({
    ...maintenance(from, to),
    id,
    kind,
    body: { en: 'x' },
  });

  it('puts a live incident above everything else', () => {
    const view = appState({
      ...base,
      release: release('1.5.0', '1.0.0'),
      notices: [
        at('notice', 'n', NOW - HOUR, NOW + HOUR),
        at('maintenance', 'm', NOW - HOUR, NOW + HOUR),
        at('incident', 'i', NOW - HOUR, NOW + HOUR),
      ],
    });
    expect(view.notices.map((n) => n.id)).toEqual(['i', 'm', 'n']);
    expect(view.banner).toMatchObject({ channel: 'notice', id: 'i' });
  });

  it('lets a soft update outrank a plain announcement', () => {
    const view = appState({
      ...base,
      release: release('1.5.0', '1.0.0'),
      notices: [at('notice', 'n', NOW - HOUR, NOW + HOUR)],
    });
    expect(view.banner).toMatchObject({ channel: 'update' });
  });

  it('lets upcoming maintenance outrank a soft update', () => {
    const view = appState({
      ...base,
      release: release('1.5.0', '1.0.0'),
      notices: [at('maintenance', 'm', NOW + 2 * HOUR, NOW + 4 * HOUR)],
    });
    expect(view.banner).toMatchObject({ channel: 'notice', id: 'm' });
  });

  it('shows no banner at all under the wall', () => {
    const view = appState({
      ...base,
      release: release('2.0.0', '2.0.0'),
      notices: [at('incident', 'i', NOW - HOUR, NOW + HOUR)],
    });
    expect(view.gate).toBe(AppGate.UpdateRequired);
    expect(view.banner).toBeNull();
    // Still reported, so a screen that wants to say both can.
    expect(view.notices).toHaveLength(1);
  });
});

describe('operator prose', () => {
  const withBody = (body: unknown) => ({
    ...maintenance(NOW - HOUR, NOW + HOUR),
    kind: 'incident',
    body,
  });

  it("prefers the reader's language", () => {
    const view = appState({
      ...base,
      locale: 'ta',
      notices: [withBody({ en: 'Sync is slow.', ta: 'ஒத்திசைவு மெதுவாக உள்ளது.' })],
    });
    expect(view.notices[0]?.text).toEqual({
      text: 'ஒத்திசைவு மெதுவாக உள்ளது.',
      lang: 'ta',
      matchesReader: true,
    });
  });

  it('falls back to English and says so', () => {
    const view = appState({ ...base, locale: 'hi', notices: [withBody({ en: 'Sync is slow.' })] });
    expect(view.notices[0]?.text).toEqual({
      text: 'Sync is slow.',
      lang: 'en',
      matchesReader: false,
    });
  });

  it('shows the one language that was written, labelled, rather than nothing', () => {
    const view = appState({
      ...base,
      locale: 'hi',
      notices: [withBody({ ar: 'المزامنة بطيئة.' })],
    });
    expect(view.notices[0]?.text).toMatchObject({ lang: 'ar', matchesReader: false });
  });

  it('renders operator text as text: no markup survives', () => {
    const view = appState({
      ...base,
      notices: [withBody({ en: '<script>alert(1)</script>\u0007 back  soon' })],
    });
    expect(view.notices[0]?.text?.text).toBe('scriptalert(1)/script back soon');
  });

  it('truncates rather than letting a wall of text through', () => {
    const view = appState({ ...base, notices: [withBody({ en: 'a'.repeat(900) })] });
    expect(view.notices[0]?.text?.text.length).toBe(500);
  });

  it('drops a plain notice with nothing to say, and keeps a structured one', () => {
    expect(
      appState({ ...base, notices: [{ ...withBody({}), kind: 'notice' }] }).notices,
    ).toHaveLength(0);
    expect(
      appState({ ...base, notices: [{ ...withBody({}), kind: 'maintenance' }] }).notices,
    ).toHaveLength(1);
  });
});

describe('dismissal', () => {
  it('drops a notice this device has waved away', () => {
    const notices = [{ ...maintenance(NOW - HOUR, NOW + HOUR), kind: 'incident' }];
    expect(appState({ ...base, notices }).notices).toHaveLength(1);
    expect(appState({ ...base, notices, dismissedNoticeIds: ['m1'] }).notices).toHaveLength(0);
  });
});
