/**
 * Your timeline: every expense you are on, across every group, in time order,
 * and the same expenses as places on a map.
 *
 * This file is the pure half — no React, no mirror, no map — so every decision
 * the two views make is a unit test:
 *
 *  - which expenses are in view (`filterTimeline`);
 *  - how they fall into days, and the order inside a day (`timelineDays`);
 *  - the flat rows the list draws, with a break where the day goes quiet
 *    (`timelineRows`);
 *  - which pins merge into one bubble at the current zoom (`clusterPins`);
 *  - the day's route in time order, and the running total a replay shows
 *    (`dayRoute`, `replaySteps`).
 *
 * An expense stores a *date*, not a time (`expense_date`). The time shown is
 * when it was saved, and only when it was saved on that same day: a bill from
 * Tuesday typed in on Friday has no honest time of day, so it shows none rather
 * than Friday's.
 */

import type { CategoryMeta } from '@waves/core';

/** A place, as an expense stores it (A43). */
export interface TimelinePlace {
  readonly lat: number;
  readonly lng: number;
  readonly name?: string | null;
}

export interface TimelineEntry {
  readonly id: string;
  readonly groupId: string;
  /** What the group is called, unnamed groups named by their people. */
  readonly groupName: string;
  readonly description: string | null;
  readonly category: string | null;
  /** A custom tag's display snapshot, carried as the expense stores it. */
  readonly categoryMeta: CategoryMeta | null;
  /** The whole bill, in minor units. */
  readonly amount: bigint;
  readonly currency: string;
  /** The bill's own day, 'YYYY-MM-DD'. */
  readonly day: string;
  /** Epoch ms of the moment it was saved, or null when that was another day. */
  readonly at: number | null;
  readonly place: TimelinePlace | null;
  /** Whether I paid towards it or owe a share of it. */
  readonly mine: boolean;
  /** What I paid minus what I owe: positive, I lent; negative, I borrowed. */
  readonly myNet: bigint;
  /** Still on this phone's queue, not yet on the server. */
  readonly pending: boolean;
}

export type TimelineRange = 'all' | '7d' | '30d' | '90d';

export interface TimelineFilter {
  readonly range: TimelineRange;
  /** One group, or every group when null. */
  readonly groupId: string | null;
  /** Only expenses I paid towards or have a share of. */
  readonly onlyMine: boolean;
}

/** 'YYYY-MM-DD' for a moment, in the phone's own calendar. */
export function localDay(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The time of day to show for a bill, or null.
 *
 * `savedAt` is when the expense was written. It is the bill's time only when it
 * was written on the bill's own day; otherwise it is the time somebody got round
 * to typing it, and showing that as the time of the dinner would be a lie.
 */
export function timeOfDay(day: string, savedAt: string | null | undefined): number | null {
  if (!savedAt) return null;
  const ms = Date.parse(savedAt);
  if (!Number.isFinite(ms)) return null;
  return localDay(ms) === day ? ms : null;
}

const RANGE_DAYS: Record<Exclude<TimelineRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** The first day inside a range, counting today as day one. */
export function rangeStart(range: TimelineRange, today: string): string | null {
  if (range === 'all') return null;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const start = new Date(y, m - 1, d);
  start.setDate(start.getDate() - (RANGE_DAYS[range] - 1));
  return localDay(start.getTime());
}

export function filterTimeline(
  entries: readonly TimelineEntry[],
  filter: TimelineFilter,
  today: string,
): TimelineEntry[] {
  const from = rangeStart(filter.range, today);
  return entries.filter(
    (entry) =>
      (filter.groupId === null || entry.groupId === filter.groupId) &&
      (!filter.onlyMine || entry.mine) &&
      (from === null || entry.day >= from),
  );
}

export interface TimelineDay {
  readonly day: string;
  /** Oldest first: a day reads morning to night. */
  readonly entries: readonly TimelineEntry[];
  /** The day's spend per currency, never summed across currencies (ADR-004). */
  readonly totals: ReadonlyMap<string, bigint>;
}

/**
 * Inside a day, bills with a time go in time order, and bills without one
 * (added on another day) follow them, newest-added first so the order is stable.
 */
function withinDay(a: TimelineEntry, b: TimelineEntry): number {
  if (a.at !== null && b.at !== null) return a.at - b.at;
  if (a.at !== null) return -1;
  if (b.at !== null) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Days newest first, each day's bills in the order they happened. */
export function timelineDays(entries: readonly TimelineEntry[]): TimelineDay[] {
  const byDay = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const list = byDay.get(entry.day);
    if (list) list.push(entry);
    else byDay.set(entry.day, [entry]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, list]) => {
      const sorted = [...list].sort(withinDay);
      const totals = new Map<string, bigint>();
      for (const entry of sorted) {
        totals.set(entry.currency, (totals.get(entry.currency) ?? 0n) + entry.amount);
      }
      return { day, entries: sorted, totals };
    });
}

export type TimelineRow =
  | { readonly kind: 'day'; readonly key: string; readonly day: TimelineDay }
  | {
      readonly kind: 'entry';
      readonly key: string;
      readonly entry: TimelineEntry;
      /** First and last of its day: where the rail starts and stops. */
      readonly first: boolean;
      readonly last: boolean;
    }
  | { readonly kind: 'gap'; readonly key: string; readonly hours: number };

/** Hours of quiet between two bills that the rail marks with a break. */
export const GAP_HOURS = 3;

/** The flat list the timeline draws: a header per day, a row per bill, and a
 *  break wherever GAP_HOURS or more went by between two timed bills. */
export function timelineRows(days: readonly TimelineDay[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const day of days) {
    rows.push({ kind: 'day', key: `day:${day.day}`, day });
    day.entries.forEach((entry, index) => {
      const previous = index > 0 ? day.entries[index - 1] : undefined;
      if (previous && previous.at !== null && entry.at !== null) {
        const hours = (entry.at - previous.at) / 3_600_000;
        if (hours >= GAP_HOURS) {
          rows.push({ kind: 'gap', key: `gap:${entry.id}`, hours: Math.floor(hours) });
        }
      }
      rows.push({
        kind: 'entry',
        key: `entry:${entry.id}`,
        entry,
        first: index === 0,
        last: index === day.entries.length - 1,
      });
    });
  }
  return rows;
}

/** Where a bill sits in the rows, for scrolling to it. -1 when it is not there. */
export function rowIndexOf(rows: readonly TimelineRow[], expenseId: string): number {
  return rows.findIndex((row) => row.kind === 'entry' && row.entry.id === expenseId);
}

// ─────────────────────────────────────────────────────────────── the map ──

export interface MapRegion {
  readonly latitude: number;
  readonly longitude: number;
  readonly latitudeDelta: number;
  readonly longitudeDelta: number;
}

export interface PinCluster {
  /** Stable while its members are: the lowest member id. */
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly entries: readonly TimelineEntry[];
  /** The bubble's figure, when every member is in one currency. */
  readonly total: { readonly amount: bigint; readonly currency: string } | null;
}

/** Bills that have a place. */
export function pinned(entries: readonly TimelineEntry[]): TimelineEntry[] {
  return entries.filter((entry) => entry.place !== null);
}

/**
 * Pins that would overlap on screen, merged into one bubble.
 *
 * A grid over the visible region, `cellPx` wide on screen: pins sharing a cell
 * become one cluster at their centre. Cheap, stable while the map is still, and
 * good enough at the dozens-to-hundreds of pins one person's spending makes.
 */
export function clusterPins(
  entries: readonly TimelineEntry[],
  region: MapRegion,
  size: { readonly width: number; readonly height: number },
  cellPx = 64,
): PinCluster[] {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const cellLng = (region.longitudeDelta / width) * cellPx;
  const cellLat = (region.latitudeDelta / height) * cellPx;
  const cells = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    if (!entry.place) continue;
    const cx = cellLng > 0 ? Math.floor(entry.place.lng / cellLng) : 0;
    const cy = cellLat > 0 ? Math.floor(entry.place.lat / cellLat) : 0;
    const key = `${cx}:${cy}`;
    const list = cells.get(key);
    if (list) list.push(entry);
    else cells.set(key, [entry]);
  }
  return [...cells.values()].map((members) => {
    const lat = members.reduce((sum, e) => sum + e.place!.lat, 0) / members.length;
    const lng = members.reduce((sum, e) => sum + e.place!.lng, 0) / members.length;
    const currency = members[0]!.currency;
    const oneCurrency = members.every((e) => e.currency === currency);
    const id = members.map((e) => e.id).sort()[0]!;
    return {
      id,
      lat,
      lng,
      entries: members,
      total: oneCurrency
        ? { amount: members.reduce((sum, e) => sum + e.amount, 0n), currency }
        : null,
    };
  });
}

/** A region that shows every point, with a margin; null for no points. */
export function regionFor(
  points: readonly { readonly lat: number; readonly lng: number }[],
): MapRegion | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  // A single place, or several at one address, still wants street level.
  const latSpan = Math.max((maxLat - minLat) * 1.6, 0.01);
  const lngSpan = Math.max((maxLng - minLng) * 1.6, 0.01);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latSpan,
    longitudeDelta: lngSpan,
  };
}

/** The day's pinned bills in the order they happened: the route line's points. */
export function dayRoute(day: TimelineDay | undefined): TimelineEntry[] {
  return day ? pinned(day.entries) : [];
}

export interface ReplayStep {
  readonly entry: TimelineEntry;
  /** Spent so far that day, in this bill's currency, this bill included. */
  readonly soFar: bigint;
}

/** One step per pinned bill of the day, with the running total a replay shows. */
export function replaySteps(day: TimelineDay | undefined): ReplayStep[] {
  const totals = new Map<string, bigint>();
  return dayRoute(day).map((entry) => {
    const soFar = (totals.get(entry.currency) ?? 0n) + entry.amount;
    totals.set(entry.currency, soFar);
    return { entry, soFar };
  });
}

/** The days that have at least one pinned bill: the map's day strip. */
export function mappedDays(days: readonly TimelineDay[]): TimelineDay[] {
  return days.filter((day) => day.entries.some((entry) => entry.place !== null));
}
