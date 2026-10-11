/**
 * How the voice mic gets from a tap to a live recogniser as fast as it can —
 * pure, so the rules are tested apart from the native modules.
 *
 * Two things used to sit serially between the tap and the mic:
 *
 *  - **The entitlement wait.** Whether Pro advanced voice is on is a server
 *    answer (`waves_my_voice_agent_enabled`), and on a cold start it was not in
 *    yet, so every start waited up to 1.5 s for it — almost always to learn
 *    "not Pro", which buys nothing. The last answer is now remembered on the
 *    phone, and {@link planAgentWait} starts on it instead of waiting.
 *  - **The installed-model probe.** `getSupportedLocales` is slow on Android and
 *    was asked on every start. {@link createModelProbe} asks once and shares
 *    the answer, so the start reads a promise that has usually long settled.
 */

/** The most a start waits for the entitlement when the last answer was Pro. */
export const AGENT_WAIT_MS = 1500;
/** The most it waits when there is no last answer at all (first ever start). */
export const AGENT_WAIT_UNKNOWN_MS = 300;

export interface AgentWaitInputs {
  /** The live answer (entitlement and consent) is in. */
  ready: boolean;
  /** The live answer says stream — meaningful only when `ready`. */
  streamLive: boolean;
  /**
   * The last answer this phone saw for "advanced voice is on for this person",
   * or null when it has never seen one.
   */
  lastKnown: boolean | null;
  /** This build can record for the stream at all. */
  streamAvailable: boolean;
}

export interface AgentWaitPlan {
  /**
   * Start the recorder at once and buffer, so no word is lost while the stream
   * is being opened. Only worth it when the stream is (or may be) the engine.
   */
  earlyCapture: boolean;
  /** How long to wait for the live answer before going on without it. */
  waitMs: number;
}

/**
 * How long a start waits for the entitlement, and whether it records meanwhile.
 *
 * - Known now: no wait; record early only when it is going to stream.
 * - Last seen as not Pro: no wait and no recorder — straight to the phone's own
 *   recogniser. If the live answer comes back Pro after all, the next start
 *   uses it.
 * - Last seen as Pro: today's behaviour — record from the press (buffered, so
 *   nothing is lost) and wait for the live answer, since streaming for somebody
 *   whose plan has lapsed is the one outcome that must not happen.
 * - Never seen: a short wait, recording meanwhile in case it is Pro; then the
 *   phone's own recogniser.
 */
export function planAgentWait(input: AgentWaitInputs): AgentWaitPlan {
  if (input.ready) {
    return { earlyCapture: input.streamLive && input.streamAvailable, waitMs: 0 };
  }
  if (input.lastKnown === false) return { earlyCapture: false, waitMs: 0 };
  return {
    earlyCapture: input.streamAvailable,
    waitMs: input.lastKnown === true ? AGENT_WAIT_MS : AGENT_WAIT_UNKNOWN_MS,
  };
}

/** Read a stored last-known answer: only an exact `true`/`false` counts. */
export function parseLastKnown(raw: string | null | undefined): boolean | null {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

export interface ModelProbe {
  /** The answer, probing only when there is none in hand (or in flight). */
  get: () => Promise<boolean>;
  /**
   * Forget a negative answer so the next `get` asks again — called when the app
   * comes back to the foreground, since a model may have been installed from
   * Settings meanwhile. A positive answer is kept: a model is not uninstalled
   * between two utterances, and a re-probe right after a session is exactly
   * when the platform answers a false "no".
   */
  invalidate: () => void;
  /** Record a positive answer learned elsewhere (a model download finished). */
  confirm: () => void;
}

/**
 * Ask `probe` once and share the answer: concurrent callers share the one
 * in-flight call, a `true` is latched for the life of the process, and a
 * `false` (or a probe that throws, which reads as `false`) is kept until
 * {@link ModelProbe.invalidate}.
 */
export function createModelProbe(probe: () => Promise<boolean>): ModelProbe {
  let confirmed = false;
  let pending: Promise<boolean> | null = null;
  return {
    get() {
      if (confirmed) return Promise.resolve(true);
      if (pending) return pending;
      const run = (async () => {
        let installed = false;
        try {
          installed = await probe();
        } catch {
          installed = false;
        }
        if (installed) confirmed = true;
        return installed;
      })();
      pending = run;
      return run;
    },
    invalidate() {
      if (!confirmed) pending = null;
    },
    confirm() {
      confirmed = true;
    },
  };
}
