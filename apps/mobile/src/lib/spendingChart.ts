/**
 * The arithmetic behind the Spending screen's pictures, kept free of React so
 * it can be tested: compact figures ("₹112K"), the axis ticks of the month
 * chart, the donut's slices, the sparkline's curve and the month-on-month
 * change.
 *
 * Everything here works on numbers drawn from minor units for *display only*.
 * Nothing feeds back into the ledger's arithmetic, and nothing converts between
 * currencies — a caller hands in one currency's figures at a time.
 */

/** 112009.92 → "112K", 71200 → "71.2K", 1250000 → "1.25M". Plain digits, no symbol. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const units: readonly [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size;
      const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      const text = trim(scaled.toFixed(digits));
      // 999,600 rounds to "1000K": say "1M" instead.
      if (Math.abs(Number(text)) >= 1000 && size < 1e9) return compactNumber(Number(text) * size);
      return `${text}${suffix}`;
    }
  }
  const plain = trim(value.toFixed(abs >= 100 ? 0 : 1));
  return Math.abs(Number(plain)) >= 1000 ? compactNumber(Number(plain)) : plain;
}

function trim(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/**
 * Round tick values from zero up to at least `max`: 0, 20K, 40K, … The step is
 * 1, 2 or 5 times a power of ten, so the labels read as round numbers.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((f) => f * power).find((s) => s >= rough) ?? power * 10;
  const ticks: number[] = [];
  for (let tick = 0; tick < max + step * 0.999; tick += step) {
    ticks.push(tick);
    if (tick >= max) break;
  }
  return ticks;
}

export interface DonutSlice<T> {
  readonly item: T;
  readonly value: number;
  /** Radians from 12 o'clock, clockwise. */
  readonly start: number;
  readonly end: number;
  readonly percent: number;
}

/**
 * Slices for the leading categories, each sized against `total` — the whole
 * period, not just the slices drawn — so what is left out reads as a gap the
 * caller fills with an "everything else" slice.
 */
export function donutSlices<T>(
  items: readonly { item: T; value: number }[],
  total: number,
): DonutSlice<T>[] {
  if (!(total > 0)) return [];
  let angle = 0;
  return items
    .filter((entry) => entry.value > 0)
    .map((entry) => {
      const sweep = (entry.value / total) * Math.PI * 2;
      const slice = {
        item: entry.item,
        value: entry.value,
        start: angle,
        end: angle + sweep,
        percent: Math.round((entry.value / total) * 100),
      };
      angle += sweep;
      return slice;
    });
}

/** SVG arc path for a ring segment's centre line, from `start` to `end` radians. */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const point = (a: number) => `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`;
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${point(start)} A ${r} ${r} 0 ${large} 1 ${point(end)}`;
}

/** A smooth line through the points (Catmull-Rom as cubic Béziers, no overshoot below `floor`). */
export function smoothPath(points: readonly { x: number; y: number }[], floor: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1y = Math.min(p1.y + (p2.y - p0.y) / 6, floor);
    const c2y = Math.min(p2.y - (p3.y - p1.y) / 6, floor);
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${c1y} ${p2.x - (p3.x - p1.x) / 6} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * Whole-percent change from `previous` to `current`, or null when there is no
 * earlier month to compare with (or it was nothing, which has no percentage).
 */
export function percentChange(current: bigint, previous: bigint | null): number | null {
  if (previous === null || previous <= 0n) return null;
  return Math.round((Number(current - previous) / Number(previous)) * 100);
}

/** The month a step before `month` ('YYYY-MM-DD'), as 'YYYY-MM-01'. */
export function previousMonthKey(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** `count` consecutive month keys ending at `last`, oldest first. */
export function monthRange(last: string, count: number): string[] {
  const keys = [last];
  while (keys.length < count) keys.unshift(previousMonthKey(keys[0]!));
  return keys;
}

/**
 * The month to show: the one picked when it is a slot on the chart (spending or
 * not — an empty month is shown as nothing, not swapped for another), else the
 * latest month with spending.
 */
export function selectableMonth(
  picked: string | null,
  latest: string | null,
  spendingMonths: readonly string[],
  slots = 12,
): string | null {
  if (!latest) return null;
  if (picked && (spendingMonths.includes(picked) || monthRange(latest, slots).includes(picked))) {
    return picked;
  }
  return latest;
}

/**
 * The window of month keys for the chart: `size` months ending at the latest,
 * slid back so it still includes `selected` when that is older than the window.
 */
export function chartMonths(latest: string, selected: string, size: number): string[] {
  const keys = monthRange(latest, size);
  if (selected >= keys[0]!) return keys;
  let end = selected;
  for (let step = 1; step < size; step++) end = nextMonthKey(end);
  return monthRange(end, size);
}

function nextMonthKey(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
