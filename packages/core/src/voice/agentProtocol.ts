/**
 * The advanced-voice contract (Pro): the app records a clip, the `voice-agent`
 * edge function transcribes it (Deepgram) and turns it into proposed actions
 * (Claude tool use), and the app confirms each write before running it through
 * its own write paths. Nothing here writes on the server — "AI proposes, human
 * confirms" (ADR-008).
 *
 * Money is integer minor units as a decimal string (bigint-safe over JSON).
 * Ids are the caller's own group and member ids, resolved server-side from the
 * names spoken; an action never names a member of a group the caller is not in.
 */

export const VOICE_AGENT_SCHEMA_VERSION = 1;

/** Longest clip the function accepts. */
export const VOICE_AGENT_MAX_CLIP_MS = 60_000;

/** Advanced commands a month on the free tier, and the Pro fair-use cap. */
export const VOICE_AGENT_FREE_MONTHLY = 10;
export const VOICE_AGENT_PRO_MONTHLY = 150;

/**
 * Live streams a month (one per `voice-stream` connect, or per
 * `voice-stream-token` mint from older builds): 3x the command allowance.
 * Counted on their own because a stream opened and abandoned still bills
 * Deepgram minutes but spends no command.
 */
export const VOICE_STREAM_FREE_MONTHLY = 3 * VOICE_AGENT_FREE_MONTHLY;
export const VOICE_STREAM_PRO_MONTHLY = 3 * VOICE_AGENT_PRO_MONTHLY;

export interface VoiceAgentRequest {
  readonly schemaVersion: typeof VOICE_AGENT_SCHEMA_VERSION;
  /**
   * What was said, already transcribed — the streaming path: the app streams the
   * mic to Deepgram live (through the `voice-stream` relay) and sends only text.
   * When present, the audio fields are ignored.
   */
  readonly transcript?: string;
  /** Base64 audio (m4a/aac, wav or webm) — the older record-then-send path. */
  readonly audioBase64?: string;
  readonly mimeType?: string;
  readonly durationMs?: number;
  /** The group screen the mic was opened from, if any — a strong default. */
  readonly groupId?: string | null;
  /** UI locale (en, hi, ta, ar) — a language hint for transcription. */
  readonly locale: string;
  /** The caller's local date (YYYY-MM-DD), for "yesterday", "on Monday". */
  readonly today: string;
  /** An answer to the agent's last clarifying question: what was said first
   *  and what was asked, so this clip is read as the reply. */
  readonly followUp?: { readonly transcript: string; readonly question: string };
  /**
   * Count this command against the month's allowance without reading it: the
   * app parsed a streamed sentence on the device (the fast path) and only needs
   * it metered. The server reserves one command and answers `{actions: [],
   * quota}`, or 402 when the allowance is spent.
   */
  readonly meterOnly?: boolean;
}

/**
 * Where the mic was opened and the UI locale: the `voice-stream` relay's query
 * (`?locale=&groupId=`), and the `voice-stream-token` body for older builds.
 */
export interface VoiceStreamTokenRequest {
  readonly groupId?: string | null;
  readonly locale: string;
}

/**
 * A short-lived Deepgram token and the exact live-transcription URL to open with
 * it (model, language, linear16 @ 16 kHz mono, interim results, numerals, the
 * caller's names as keyterms). The app opens `url` as a WebSocket with
 * subprotocols ['bearer', token] and streams raw PCM; the token only has to be
 * valid when the socket opens.
 */
export interface VoiceStreamTokenResponse {
  readonly token: string;
  readonly url: string;
  readonly expiresInSeconds: number;
  readonly sampleRate: 16000;
  readonly encoding: 'linear16';
}

export type VoiceSplitMode = 'equal' | 'exact' | 'percent' | 'shares';

export interface VoiceSplitShare {
  readonly memberId: string;
  /** exact: minor units; percent: 0–100; shares: weight. Omitted for equal. */
  readonly value?: string;
}

export type VoiceAgentAction =
  | {
      readonly type: 'add_expense';
      readonly groupId: string;
      readonly description: string;
      readonly amountMinor: string;
      readonly currency: string;
      /** Who paid; one payer for v1. */
      readonly paidByMemberId: string;
      readonly split: {
        readonly mode: VoiceSplitMode;
        readonly shares: readonly VoiceSplitShare[];
      };
      readonly category?: string;
      /** YYYY-MM-DD; today when omitted. */
      readonly date?: string;
    }
  | {
      /** A spend that is nobody else's — the personal ledger. */
      readonly type: 'add_personal';
      readonly description: string;
      readonly amountMinor: string;
      readonly currency: string;
      readonly category?: string;
      readonly date?: string;
    }
  | {
      readonly type: 'record_settlement';
      readonly groupId: string;
      readonly fromMemberId: string;
      readonly toMemberId: string;
      readonly amountMinor: string;
      readonly currency: string;
    }
  | {
      readonly type: 'nudge';
      readonly groupId: string;
      readonly toMemberId: string;
      readonly currency: string;
    }
  | {
      readonly type: 'create_group';
      readonly name: string;
      /** trip | home | couple | friends | event | other */
      readonly groupType: string;
      readonly currency: string;
      /** People to add as members, by name (new ghosts unless matched). */
      readonly memberNames: readonly string[];
    }
  | {
      readonly type: 'add_member';
      readonly groupId: string;
      readonly name: string;
    };

export interface VoiceAgentResponse {
  readonly schemaVersion: typeof VOICE_AGENT_SCHEMA_VERSION;
  readonly transcript: string;
  /** Writes to confirm, in the order spoken. */
  readonly actions: readonly VoiceAgentAction[];
  /** A spoken-style answer for a question ("Anu owes you ₹1,250 in Goa"). */
  readonly answer?: string;
  /** Asked when the request is ambiguous; no actions are proposed with it. */
  readonly clarify?: string;
  readonly quota: {
    readonly used: number;
    readonly limit: number;
    readonly tier: 'free' | 'plus' | 'pro';
  };
}

/** Error codes the function answers with (HTTP status in brackets). */
export enum VoiceAgentError {
  /** [402] Free/Pro monthly allowance used up — fall back to basic voice. */
  QuotaReached = 'VOICE_AGENT_QUOTA',
  /** [402] This month's live-stream token budget used up — listen on the phone. */
  StreamBudget = 'VOICE_STREAM_BUDGET',
  /** [503] Flag off, or a provider key missing — fall back to basic voice. */
  Unavailable = 'VOICE_AGENT_UNAVAILABLE',
  /** [413] Clip longer than VOICE_AGENT_MAX_CLIP_MS. */
  ClipTooLong = 'VOICE_AGENT_CLIP_TOO_LONG',
  /** [422] Nothing intelligible was heard. */
  NothingHeard = 'VOICE_AGENT_NOTHING_HEARD',
}
