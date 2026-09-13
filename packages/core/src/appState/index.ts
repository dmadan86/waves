/**
 * What the operator is currently saying to every running copy of the app.
 *
 * ## Why this exists at all
 *
 * A shipped build cannot be told anything. It can only ask. So there is one
 * place the operator writes — two tables, `app_releases` and `app_notices` —
 * and one function here that turns whatever came back into the single sentence
 * a screen should carry. Four things the operator needs to be able to say:
 *
 *   * **a newer build exists** — a banner, waved away per version
 *     (`app_releases.latest_version`);
 *   * **this build may no longer run** — the wall
 *     (`app_releases.minimum_version`);
 *   * **the server is down between X and Y** — maintenance, announced before
 *     it starts and again while it is happening;
 *   * **something is broken right now** — an incident, and a plain notice for
 *     everything else worth saying.
 *
 * ## The rule the shape of this module enforces
 *
 * **Nothing here may stop somebody adding an expense.** Waves works with no
 * server at all: the ledger is a local mirror, writes go to an offline queue,
 * and the queue drains when a server comes back. A maintenance window is that
 * state on purpose rather than by accident, so it must leave the app exactly as
 * usable as a train tunnel does.
 *
 * That is not a convention here, it is the type. `AppStateView.gate` is
 * `AppGate`, whose only non-`None` member is `UpdateRequired`, and it is
 * computed from the release policy alone — `noticeGate` does not exist and
 * cannot be added without changing this enum, which is a change somebody has to
 * write down. A notice can occupy the banner; it has no vocabulary for
 * anything else.
 *
 * ## Fail open, every time
 *
 * Every input to this function is `unknown`, because every one of them arrives
 * over a network from a server that may be the very thing having the bad day.
 * Nothing is parsed optimistically: a row with the wrong shape, a version
 * string with a letter in it, a JSON body that turned out to be a number, a
 * policy whose minimum sits above every build ever shipped — all of them end at
 * `gate: None, banner: null`.
 *
 * A version gate that triggered on a *failed* fetch would lock people out of
 * their own ledger during precisely the outage it was written to describe. That
 * is the accident this module is arranged around, and `appState({})` returning
 * silence is the test that says so.
 *
 * ## Operator prose and the four languages
 *
 * An operator writes at 2am in one language. The app ships in four. So the
 * *shape* of every message is translated at build time and the operator's words
 * are optional decoration on top of it:
 *
 *   * A maintenance notice is `kind` plus two timestamps. From those the app
 *     composes a complete, correctly-formatted sentence in Tamil, Hindi, Arabic
 *     or English with no operator text involved at all. This is the normal case
 *     and it needs no translator.
 *   * `body` is an optional per-locale map — `{"en": "...", "ta": "..."}` — for
 *     when there is genuinely more to say. It resolves to the reader's language
 *     if the operator wrote it, otherwise to English, and the result reports
 *     which language it is in (`matchesReader`) so the screen can label it
 *     rather than leave somebody staring at a wall of a language they do not
 *     read with no explanation of why.
 *   * A `notice` with no body in any language is nothing, and is dropped. A
 *     `maintenance` or `incident` with no body still says everything it needs
 *     to from its structure.
 *
 * ## Operator text is untrusted for rendering
 *
 * It is written by an admin, not a stranger, but the destination is four
 * different renderers (React Native `Text`, the admin console's DOM, and
 * whatever comes next) and "an admin would not do that" is not a property of a
 * string. So `operatorText` strips control characters and angle brackets,
 * collapses runs of whitespace, and truncates. Nothing downstream may linkify
 * it, feed it to a markdown renderer, or put it in `dangerouslySetInnerHTML`.
 */

import { decideUpdate, UpdateDecision } from '../version/index';

/** The one thing allowed to stand between somebody and their ledger. */
export enum AppGate {
  /** Overwhelmingly the answer. */
  None = 'none',
  /**
   * The installed build is below `minimum_version`. The only member that is not
   * `None`, and deliberately the only one: adding a second would mean writing
   * down why a notice is now allowed to do what a notice must never do.
   */
  UpdateRequired = 'update-required',
}

/** What an operator notice is about. Presentation follows from this. */
export enum NoticeKind {
  /** Planned, with a start and an end. Announced before it begins. */
  Maintenance = 'maintenance',
  /** Unplanned and happening now. */
  Incident = 'incident',
  /** Everything else worth saying to everybody at once. */
  Notice = 'notice',
}

/** Where `now` sits relative to a notice's window. */
export enum NoticePhase {
  /** Announced, not started. "Maintenance on Sunday at 2am." */
  Upcoming = 'upcoming',
  /** Between `startsAt` and `endsAt`, or windowless and live. */
  Active = 'active',
}

/** The operator's own words, and whether the reader can read them. */
export interface OperatorText {
  /** Sanitised, never markup. */
  readonly text: string;
  /** The locale it was actually written in — `'en'` when nothing else matched. */
  readonly lang: string;
  /** False when the reader is being shown a language they did not ask for. */
  readonly matchesReader: boolean;
}

/** One notice that applies to this device, right now. */
export interface LiveNotice {
  readonly id: string;
  readonly kind: NoticeKind;
  readonly phase: NoticePhase;
  /** Epoch ms, or null for a notice with no window. */
  readonly startsAt: number | null;
  readonly endsAt: number | null;
  readonly text: OperatorText | null;
}

/** The single thing a screen should carry, if anything. */
export type Banner =
  | {
      readonly channel: 'update';
      /** Only ever `Suggested`; `Required` is a gate, not a banner. */
      readonly decision: UpdateDecision.Suggested;
      readonly latestVersion: string;
      readonly storeUrl: string | null;
      readonly text: OperatorText | null;
    }
  | ({ readonly channel: 'notice' } & LiveNotice);

/** Everything the app knows that bears on what it should say. */
export interface AppStateInput {
  /** What this binary calls itself. Unparseable is treated as "do not know". */
  readonly installedVersion: string;
  /** The `app_releases` row for this store, raw and unvalidated. */
  readonly release?: unknown;
  /** The `app_notices` rows, raw and unvalidated. */
  readonly notices?: unknown;
  /** `null` on a platform with no store (web), which disables the update half. */
  readonly platform?: 'ios' | 'android' | 'web' | null;
  /** ISO-3166 alpha-2, for region-scoped notices. Null means "unscoped only". */
  readonly country?: string | null;
  /** The reader's language, for resolving `body`. */
  readonly locale?: string;
  /** Epoch ms. Passed in rather than read, so every window is testable. */
  readonly now: number;
  /** The `latest_version` the soft prompt was already waved away for. */
  readonly dismissedUpdateVersion?: string | null;
  /** Notice ids already waved away on this device. */
  readonly dismissedNoticeIds?: readonly string[];
}

export interface AppStateView {
  /** Computed from the release policy alone. See the enum. */
  readonly gate: AppGate;
  /** The newest build, when the policy said. Shown on the wall. */
  readonly latestVersion: string | null;
  /** Where the wall's button goes. Null means the wall shows no button. */
  readonly storeUrl: string | null;
  /** Whatever the release policy wanted said instead of the stock wording. */
  readonly gateText: OperatorText | null;
  /** The one message worth a banner, or null. */
  readonly banner: Banner | null;
  /** Every live notice, most severe first. The banner is the first of these. */
  readonly notices: readonly LiveNotice[];
}

const SILENT: AppStateView = {
  gate: AppGate.None,
  latestVersion: null,
  storeUrl: null,
  gateText: null,
  banner: null,
  notices: [],
};

/** The longest operator sentence anybody gets. Matches the database CHECK. */
const MAX_TEXT = 500;

/**
 * Make an operator string safe to render anywhere and bounded in length.
 *
 * Angle brackets go because this same string reaches a DOM in the admin console
 * and a `Text` node on a phone, and the cheapest way to guarantee neither ever
 * interprets it is for it not to contain the characters that would be
 * interpreted. Control characters go because a lone `\r` or a bidi override
 * inside a right-to-left layout can reorder the sentence around it — a message
 * that says the opposite of what was typed is worse than no message.
 */
function sanitise(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    // Control characters, and the bidi overrides that can silently reverse a
    // sentence inside a right-to-left layout.
    // eslint-disable-next-line no-control-regex -- removing them is the point.
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_TEXT ? `${cleaned.slice(0, MAX_TEXT - 1).trimEnd()}…` : cleaned;
}

/**
 * Pick the operator's words for this reader.
 *
 * Their language, then English, then whatever single language was written —
 * because one sentence somebody can paste into a translator beats a blank
 * banner, and `matchesReader` tells the screen to say which language it is.
 */
function operatorText(body: unknown, locale: string): OperatorText | null {
  const wanted = locale.slice(0, 2).toLowerCase();

  if (typeof body === 'string') {
    const text = sanitise(body);
    return text ? { text, lang: 'en', matchesReader: wanted === 'en' } : null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const table = body as Record<string, unknown>;
  const mine = sanitise(table[wanted]);
  if (mine) return { text: mine, lang: wanted, matchesReader: true };

  const english = sanitise(table.en);
  if (english) return { text: english, lang: 'en', matchesReader: wanted === 'en' };

  for (const [lang, value] of Object.entries(table)) {
    const text = sanitise(value);
    if (text) return { text, lang: lang.slice(0, 2).toLowerCase(), matchesReader: false };
  }
  return null;
}

/** Epoch ms from an ISO timestamp, or null for anything we cannot order. */
function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether a scope array lets this device through.
 *
 * A missing, empty or malformed array means "everybody" — the fail-open
 * direction for scoping, because the alternative is a maintenance notice that
 * silently reaches nobody because one entry was typed wrongly. An array with
 * entries is honoured exactly, and a device that does not know its own answer
 * (`mine` is null) is outside every explicit scope.
 */
function inScope(scope: unknown, mine: string | null): boolean {
  if (!Array.isArray(scope) || scope.length === 0) return true;
  const wanted = scope.filter((entry): entry is string => typeof entry === 'string');
  if (wanted.length === 0) return true;
  if (!mine) return false;
  return wanted.some((entry) => entry.toLowerCase() === mine.toLowerCase());
}

/**
 * Most urgent first: something broken now, then a pause happening now, then a
 * pause coming, then a new build, then everything else. The banner shows the
 * head of this list, so the order is the whole editorial policy.
 */
function severity(notice: LiveNotice): number {
  if (notice.kind === NoticeKind.Incident) return 100;
  if (notice.kind === NoticeKind.Maintenance) {
    return notice.phase === NoticePhase.Active ? 90 : 70;
  }
  return 30;
}

/** Where the soft update prompt sits among the notices. */
const UPDATE_SEVERITY = 50;

function readNotice(row: unknown, input: AppStateInput, locale: string): LiveNotice | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;

  const id = typeof record.id === 'string' && record.id ? record.id : null;
  if (!id) return null;

  const rawKind = record.kind;
  const kind = Object.values(NoticeKind).find((known) => known === rawKind);
  // An unknown kind is a newer server talking to an older app. Say nothing
  // rather than guess at a severity we have no wording for.
  if (!kind) return null;

  if (!inScope(record.platforms, input.platform ?? null)) return null;
  if (!inScope(record.countries, input.country ?? null)) return null;

  const now = input.now;
  const visibleFrom = instant(record.visible_from);
  const visibleUntil = instant(record.visible_until);
  // A row with no `visible_from` is live from the moment it exists; one whose
  // stamp we cannot read is treated the same way, because the row was written
  // in order to be seen.
  if (visibleFrom !== null && now < visibleFrom) return null;
  if (visibleUntil !== null && now >= visibleUntil) return null;

  const startsAt = instant(record.starts_at);
  const endsAt = instant(record.ends_at);
  // Past the end of its own window and still inside its visibility window is a
  // maintenance that over-ran or an operator who forgot. Either way the window
  // it describes has passed, so it stops speaking about it.
  if (endsAt !== null && now >= endsAt) return null;

  const phase = startsAt !== null && now < startsAt ? NoticePhase.Upcoming : NoticePhase.Active;

  const text = operatorText(record.body, locale);
  // A plain notice is *only* its words. With none in any language there is
  // nothing to show, and an empty card is worse than silence.
  if (kind === NoticeKind.Notice && !text) return null;

  if ((input.dismissedNoticeIds ?? []).includes(id)) return null;

  return { id, kind, phase, startsAt, endsAt, text };
}

interface ReleaseFacts {
  readonly decision: UpdateDecision;
  readonly latestVersion: string | null;
  readonly storeUrl: string | null;
  readonly text: OperatorText | null;
}

const NO_RELEASE: ReleaseFacts = {
  decision: UpdateDecision.None,
  latestVersion: null,
  storeUrl: null,
  text: null,
};

function readRelease(row: unknown, input: AppStateInput, locale: string): ReleaseFacts {
  // Web has no store to be sent to, so there is no policy to enforce and a
  // wall would be a dead end with a button that does nothing.
  if (input.platform !== 'ios' && input.platform !== 'android') return NO_RELEASE;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return NO_RELEASE;

  const record = row as Record<string, unknown>;
  const latest = typeof record.latest_version === 'string' ? record.latest_version : null;
  const minimum = typeof record.minimum_version === 'string' ? record.minimum_version : null;
  if (!latest || !minimum) return NO_RELEASE;

  const storeUrl =
    typeof record.store_url === 'string' && /^https:\/\/\S+$/.test(record.store_url)
      ? record.store_url
      : null;

  return {
    // `decideUpdate` already refuses a minimum above the latest — the shape a
    // typo takes, and one that would otherwise block every build in existence,
    // including the one somebody would be sent to install.
    decision: decideUpdate(input.installedVersion, {
      latestVersion: latest,
      minimumVersion: minimum,
    }),
    latestVersion: latest,
    storeUrl,
    text: operatorText(record.message, locale),
  };
}

/**
 * Everything the operator is saying to this device, resolved to one answer.
 *
 * Pure: same inputs, same output, no clock and no network of its own. `now` is
 * an argument precisely so a maintenance window that has not started, is
 * running, and has passed are three ordinary assertions rather than three
 * timing-dependent tests.
 */
export function appState(input: AppStateInput): AppStateView {
  const locale = input.locale ?? 'en';

  let release: ReleaseFacts;
  let notices: LiveNotice[];
  try {
    release = readRelease(input.release, input, locale);
    notices = (Array.isArray(input.notices) ? input.notices : [])
      .map((row) => readNotice(row, input, locale))
      .filter((notice): notice is LiveNotice => notice !== null)
      .sort((a, b) => severity(b) - severity(a));
  } catch {
    // Nothing above should throw. If a future edit makes it possible, silence
    // is the answer — this function stands between people and their ledger.
    return SILENT;
  }

  if (release.decision === UpdateDecision.Required) {
    // The wall replaces the screen, so there is no room for a banner under it
    // and no point computing one. The notices are still returned: a screen that
    // wants to say "and the server is down too" has them.
    return {
      gate: AppGate.UpdateRequired,
      latestVersion: release.latestVersion,
      storeUrl: release.storeUrl,
      gateText: release.text,
      banner: null,
      notices,
    };
  }

  const wantsUpdateBanner =
    release.decision === UpdateDecision.Suggested &&
    release.latestVersion !== null &&
    input.dismissedUpdateVersion !== release.latestVersion;

  const head = notices[0];
  const noticeWins = head !== undefined && (!wantsUpdateBanner || severity(head) > UPDATE_SEVERITY);

  const banner: Banner | null = noticeWins
    ? { channel: 'notice', ...head }
    : wantsUpdateBanner && release.latestVersion !== null
      ? {
          channel: 'update',
          decision: UpdateDecision.Suggested,
          latestVersion: release.latestVersion,
          storeUrl: release.storeUrl,
          text: release.text,
        }
      : null;

  return {
    gate: AppGate.None,
    latestVersion: release.latestVersion,
    storeUrl: release.storeUrl,
    gateText: release.text,
    banner,
    notices,
  };
}
