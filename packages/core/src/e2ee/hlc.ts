/**
 * Hybrid logical clock. A stamp is the string `wallMs:counter:deviceId`; the
 * total order is (wall, counter, deviceId), so two devices never tie.
 */

export interface Hlc {
  readonly wall: number;
  readonly counter: number;
  readonly device: string;
}

export const formatHlc = (h: Hlc): string => `${h.wall}:${h.counter}:${h.device}`;

export function parseHlc(s: string): Hlc {
  const a = s.indexOf(':');
  const b = s.indexOf(':', a + 1);
  const wall = Number(s.slice(0, a));
  const counter = Number(s.slice(a + 1, b));
  if (
    a < 0 ||
    b < 0 ||
    !Number.isSafeInteger(wall) ||
    !Number.isSafeInteger(counter) ||
    b === s.length - 1
  ) {
    throw new Error(`e2ee: bad hlc "${s}"`);
  }
  return { wall, counter, device: s.slice(b + 1) };
}

/** Negative, zero or positive, like Array.sort. */
export function compareHlc(a: string, b: string): number {
  const x = parseHlc(a);
  const y = parseHlc(b);
  if (x.wall !== y.wall) return x.wall - y.wall;
  if (x.counter !== y.counter) return x.counter - y.counter;
  return x.device < y.device ? -1 : x.device > y.device ? 1 : 0;
}

/** Stamp for a local event. `last` is this device's previous stamp, if any. */
export function tick(last: string | null, now: number, device: string): string {
  const p = last ? parseHlc(last) : null;
  const wall = Math.max(now, p?.wall ?? 0);
  return formatHlc({ wall, counter: p && p.wall === wall ? p.counter + 1 : 0, device });
}

/** Stamp after receiving `remote`: the result is later than both `last` and `remote`. */
export function receive(last: string | null, remote: string, now: number, device: string): string {
  const l = last ? parseHlc(last) : { wall: 0, counter: -1, device };
  const r = parseHlc(remote);
  const wall = Math.max(now, l.wall, r.wall);
  const counters = [l, r].filter((h) => h.wall === wall).map((h) => h.counter);
  return formatHlc({ wall, counter: counters.length ? Math.max(...counters) + 1 : 0, device });
}
