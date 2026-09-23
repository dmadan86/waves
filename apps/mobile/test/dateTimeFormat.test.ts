import { afterEach, describe, expect, it } from 'vitest';

import { dateTimeFormat } from '../src/lib/dateTimeFormat';

const RealDateTimeFormat = Intl.DateTimeFormat;
let constructed = 0;

function countConstructions(): void {
  constructed = 0;
  Intl.DateTimeFormat = new Proxy(RealDateTimeFormat, {
    construct(target, args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      constructed += 1;
      return new target(...args);
    },
  });
}

afterEach(() => {
  Intl.DateTimeFormat = RealDateTimeFormat;
});

describe('dateTimeFormat cache', () => {
  const day = new Date(Date.UTC(2026, 8, 3));
  const header = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } as const;

  it('formats exactly as a fresh formatter does', () => {
    for (const locale of ['en-IN', 'ta-IN', 'hi-IN', 'ar']) {
      dateTimeFormat(locale, header).format(day);
      expect(dateTimeFormat(locale, header).format(day)).toBe(
        new RealDateTimeFormat(locale, header).format(day),
      );
    }
  });

  it('builds one formatter per locale and options, then reuses it', () => {
    countConstructions();
    for (let i = 0; i < 40; i += 1) dateTimeFormat('en-GB', header).format(day);
    expect(constructed).toBe(1);

    dateTimeFormat('en-GB', { month: 'short' });
    dateTimeFormat('fr-FR', header);
    expect(constructed).toBe(3);
    // An equal options object from another call site shares the formatter.
    dateTimeFormat('en-GB', { ...header });
    expect(constructed).toBe(3);
  });

  it('does not cache a formatter that failed to build', () => {
    countConstructions();
    expect(() => dateTimeFormat('not a locale!', header)).toThrow();
    expect(() => dateTimeFormat('not a locale!', header)).toThrow();
    expect(constructed).toBe(2);
  });
});
