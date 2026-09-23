/**
 * What a "remind to settle" came to, in words for the reader.
 *
 * One reading for every place that sends a reminder — a Friends row, a group's
 * balances, the settle screen, the screen-reader action — so they cannot drift
 * apart again. The server's rate limit means one already went today, which
 * reads as done, not as an error; anything else is a send that failed, which
 * gets its own sentence rather than the "couldn't load this" a list shows.
 */
export interface NudgeOutcome {
  readonly ok: boolean;
  readonly label: string;
}

interface NudgeStrings {
  readonly people: {
    readonly reminded: string;
    readonly remindedToday: string;
    readonly remindFailed: string;
  };
}

export function nudgeSent(t: NudgeStrings): NudgeOutcome {
  return { ok: true, label: t.people.reminded };
}

export function nudgeOutcome(error: unknown, t: NudgeStrings): NudgeOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('NUDGE_RATE_LIMIT')
    ? { ok: true, label: t.people.remindedToday }
    : { ok: false, label: t.people.remindFailed };
}
