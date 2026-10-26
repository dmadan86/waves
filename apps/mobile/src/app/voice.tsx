import { OwedCard } from '@/components/OwedCard';
import { RewardedAdEntry } from '@/components/RewardedAdEntry';
/**
 * Speak an expense — one or several, in any language, with an optional new group.
 *
 * Reached from the raised mic. The phone turns speech into text on-device (see
 * VoiceMicPanel). What that text means is worked out by the pure
 * {@link parseVoiceExpenses} heuristic — amounts, currencies, a named group,
 * several expenses in a breath, a spoken "make a group called X", and a
 * "just for me" that routes to the personal ledger — all with no network and no
 * model.
 *
 * Either way the last step is a review, never a blind write: the heard expenses
 * are listed, each editable, with a destination to choose — the capture inbox
 * (unassigned, the default), an existing group, or a new group the sentence
 * asked for. Only then does Save write them.
 *
 * The route imports nothing native directly: the microphone is reached through
 * VoiceMicPanel, which loads the native module inside a try, so an older binary
 * shows a message instead of crashing.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { Link, useLocalSearchParams, useNavigation } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  buildVoiceSplit,
  computeShares,
  decimalToMinor,
  encodeTxn,
  format as formatMoney,
  guessCategory,
  minorUnitScale,
  money,
  nameKey,
  peopleSignatureKey,
  resolveIntentPeople,
  type ExpenseLocation,
  type GroupUnits,
  type LearnedName,
  type SpendQuery,
  type SplitParams,
  type VoiceAmountReading,
  type VoiceIntent,
  type VoiceNameCandidate,
  type VoiceParty,
  type VoiceSplitPlan,
} from '@waves/core';
import {
  Button,
  Callout,
  Card,
  Chip,
  Divider,
  iconSize,
  Row,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import {
  useAddGhostMember,
  useAllGroupMembers,
  useCreateCapture,
  useCreateGroup,
  useGroup,
  useGroupLabeller,
  useGroupLedger,
  useGroupPeopleSignatures,
  useGroups,
  useOneToOneGroupIds,
  usePeopleBalances,
  useRecordSettlement,
  useVoiceAgentStatus,
  useWriteExpense,
} from '@/data/hooks';
import { nudgeToSettle } from '@/data/api';
import { useUpsertPersonalRecord } from '@/data/personal';
import { displayName, GroupType, isViewer, type GroupRow, type MemberRow } from '@/data/types';
import { fill, isRtl, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useViewerIdentity } from '@/lib/viewerIdentity';
import { useDefaultCurrency } from '@/lib/currency';
import { voiceNewGroupCurrency, voiceSaveCurrency } from '@/lib/voiceCurrency';
import {
  voiceAmountQuestion,
  voiceCurrencyQuestion,
  type VoiceAmountQuestion,
} from '@/lib/voiceAmountChoice';
import { friendlyError } from '@/lib/errors';
import { GROUP_TYPE_ICON, type DestinationSelection } from '@/components/DestinationPicker';
import type { CaptureStage, VoiceDoneInfo } from '@/components/VoiceCapture';
import { AssistantMoneyAnswer } from '@/components/AssistantAnswerCard';
import { VoiceMicPanel } from '@/components/VoiceMicPanel';
import { SaveToSheet, type SaveToPerson } from '@/components/SaveToSheet';
import { VoiceConsentSheet } from '@/components/VoiceConsentSheet';
import { useVoiceConsent } from '@/lib/voiceConsentStore';
import { useRewardedAdOffer } from '@/lib/useRewardedAdOffer';
import { isVoiceAssistantRequest } from '@/lib/voiceAssistantRequest';
import { useVoiceStreamsToCloud } from '@/lib/useVoiceRouting';
import { meterVoiceCommand } from '@/lib/voiceAgent';
import { checkOnline } from '@/lib/voiceStream';
import {
  CLOUD,
  engineAfterAgentFailure,
  local,
  type VoiceCloudConsent,
  type VoiceEngineInfo,
} from '@/lib/voiceEnginePure';
import {
  owedQuestionTranscript,
  localParseIsConfident,
  parseLocally,
  type FastPathContext,
} from '@/lib/voiceFastPath';
import { useAssistantAnswerer } from '@/lib/useAssistantAnswerer';
import {
  useAgentLocalData,
  VoiceAgentPanel,
  type AgentFallbackReason,
} from '@/components/VoiceAgentPanel';
import { AssistantSavedBar } from '@/components/AssistantSavedBar';
import { VoiceFollowUps } from '@/components/VoiceFollowUps';
import { VoiceDetailRows } from '@/components/voice/VoiceDetailRows';
import { VoiceSplitSheet } from '@/components/voice/VoiceSplitSheet';
import type { UndoEntry } from '@/lib/assistantUndo';
import type { AgentExpenseWrite } from '@/lib/voiceAgentPlan';
import { splitEditFromParams } from '@/lib/voiceSplitPure';
import { currentQuestion, partyQuestion, type ReviewOpen } from '@/lib/voiceReviewPure';
import { LocationField } from '@/components/LocationField';
import { useLabelledCategoryCatalog } from '@/components/Category';
import {
  captureLocation,
  locationAvailable,
  locationUnchanged,
  reverseGeocode,
} from '@/lib/location';
import { router } from '@/lib/navigation';
import { pushToTalk } from '@/lib/pushToTalk';
import { isRatelessTransfer } from '@/lib/settleCurrency';
import {
  detectAddMember,
  detectBalanceQuery,
  detectOwedDirection,
  detectMoneyIntent,
  matchMemberNames,
  parseVoiceExpenses,
  resolveVoiceParticipants,
  toVoiceMinorUnits,
  voiceAutoAction,
  type VoiceGroupRef,
  type VoiceParseResult,
} from '@/lib/voiceExpense';
import { logVoiceAttempt } from '@/lib/voiceLog';
import { learnedForGroup, voiceNameHints, withAliases } from '@/lib/voiceNames';
import { rememberNamePick, useVoiceNameMemory } from '@/lib/voiceNameStore';
import { DraftRow } from '@/components/voice/DraftRow';
import {
  ExpensePreviewCard,
  SplitLine,
  type ExpensePreview,
} from '@/components/voice/ExpensePreviewCard';
import { ReviewQuestionCard } from '@/components/voice/ReviewQuestion';
import { VoiceFooter, type FooterSpec } from '@/components/voice/VoiceFooter';
import { VoiceScene } from '@/components/voice/VoiceScene';
import { VoiceHeader, VoiceSheetBody, VoiceTop } from '@/components/voice/VoiceStage';
import type { MicMode as StageMicMode } from '@/components/voice/FloatingMicrophone';
import { suggestionWords, type Suggestion } from '@/components/voice/VoiceSuggestions';
import { useReducedMotion } from '@/lib/reducedMotion';
import {
  singleFlight,
  stageMicMode,
  stageMicTap,
  stageStatusKey,
  type VoiceStatusKey,
  voiceFlowState,
  type AgentStage,
} from '@/lib/voiceFlowPure';
import { AssistantComposer } from '@/components/AssistantComposer';
import { SavedSummary } from '@/components/voice/SavedSummary';
import { transcriptRoute } from '@/lib/assistantComposerPure';
import { hapticLight, hapticSelect, hapticSuccess } from '@/lib/assistantHaptics';
import { trackAssistant, type AssistantScope } from '@/lib/assistantTelemetry';
import { useEntitlement } from '@/lib/useEntitlement';
import { answerFollowUps, type AnswerFollowUp } from '@/lib/voiceAnswerFollowUps';
import type { SavedState } from '@/lib/followUpApply';

/** One editable line on the review screen. */
interface Draft {
  key: string;
  amount: string;
  note: string;
  currency: string | null;
  category: string | null;
  /**
   * How the spoken amount reads, when it has a question to ask ("₹15 or ₹50?",
   * "US or Australian dollars?"). Kept on the row, so a question stays with the
   * expense it is about while more are added. Save waits for every answer.
   */
  amountReading: VoiceAmountReading | null;
  amountAnswered: boolean;
  currencyAnswered: boolean;
}

/** Where the reviewed expenses will be written. */
type Dest =
  | { kind: 'unassigned' }
  // Just me: a private personal expense, no group and nobody to split with. Each
  // draft is written to the personal ledger (A48) as an expense txn.
  | { kind: 'me' }
  | { kind: 'existing'; groupId: string }
  | { kind: 'create'; groupId: string; memberId: string; name: string }
  // One or more people with no existing group between them — a fresh group made
  // on save, named after them the way WhatsApp names a new group, with a ghost
  // per person. One person is the 1:1 case; several is a real group. When those
  // same people already share a group, the picker resolves to `existing` instead
  // and this kind is never used. `groupId`/`memberId` (mine) are minted up front
  // so the create and the expense name them in the same offline batch.
  | {
      kind: 'people';
      groupId: string;
      memberId: string;
      name: string;
      ghostNames: string[];
    }
  // A spoken settle-up ("settle up with Ravi"): record a payment that clears the
  // 1:1 balance. `toMemberId` is the other person; my member id is read from the
  // group at save. `iPay` (I owe them) sets the direction; `amount` is the whole
  // balance, or a spoken partial. Not an expense — it rides the settlement path.
  | {
      kind: 'settle';
      groupId: string;
      toMemberId: string;
      amount: bigint;
      currency: string;
      iPay: boolean;
      name: string;
    }
  // A spoken reminder ("remind Ravi"): a nudge to settle. The server decides the
  // amount and wording and rate-limits it; the client sends only who and where.
  | { kind: 'remind'; groupId: string; toMemberId: string; currency: string; name: string }
  // A spoken "add Ravi to the latest group": one or more ghosts added to an
  // existing group by name. Not an expense — nothing is spent. Names already in
  // the group are skipped at save, so re-speaking adds no duplicate.
  | { kind: 'add-member'; groupId: string; names: string[]; groupName: string };

/**
 * What a returning transcript does — the full-screen mic is reused for two jobs,
 * and the job is fixed the moment the mic is opened, not read off the transcript.
 *  - 'replace'   the opening capture: the heard batch becomes the review list.
 *  - 'append'    "+ Add another": the heard expenses are pushed onto the current
 *                list, keeping the existing items and the chosen destination.
 *
 * There is no third mode: the full-screen mic is the only way to speak an
 * expense here. A row's note is corrected by typing, not dictation — the whole
 * screen is already voice, so a mic in every row was clutter doing an unclear
 * job, and it is gone.
 */
type MicMode = 'replace' | 'append';

const EQUAL: SplitParams = { kind: 'equal' };

/** Today as `YYYY-MM-DD` — the expense date a spoken expense is filed under. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A major-unit amount string to minor units in the given currency, or null when
 * it is not a number. The scale is the currency's own — 100 for rupees and
 * dollars, but 1 for yen and 1000 for dinar — so a "¥3000" expense is ¥3000, not
 * a hundredfold ¥300000. (Was a flat ×100, which only held for two-decimal
 * currencies.)
 */
function toMinor(amount: string, currency: string): bigint | null {
  const value = Number.parseFloat(amount.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return BigInt(Math.round(value * Number(minorUnitScale(currency))));
}

/** The reader's corrections to who paid and who shares. */
interface WhoEdit {
  payerId?: string;
  participantIds?: string[];
  /** A heard name settled with one tap ("Did you mean Renny?" → yes): its {@link nameKey} → member id. */
  picks?: Record<string, string>;
  /** A split set in the split sheet (exact, percent, shares or equal). */
  params?: SplitParams;
}

/** A group's members as the voice parser matches names against them. */
function toCandidates(
  members: readonly MemberRow[] | undefined,
  viewerId: string | null | undefined,
): VoiceNameCandidate[] {
  return (members ?? []).map((member) => ({
    id: member.id,
    // The viewer is "You" on screen but answers to their real name when spoken.
    name: member.profile?.display_name ?? displayName(member, viewerId),
    isMe: isViewer(member, viewerId),
  }));
}

/** The payer, people and split Save will write, and anything still in the way. */
interface WhoView {
  intent: VoiceIntent;
  payerId: string | null;
  participantIds: readonly string[];
  params: SplitParams;
  problems: VoiceSplitPlan['problems'];
  /** What the sentence meant and not the reader's correction on top of it. */
  edited: boolean;
}

function planWho(
  intent: VoiceIntent,
  members: readonly VoiceNameCandidate[],
  edit: WhoEdit | null,
  amountMinor: bigint | null,
  draftCount: number,
  learned: readonly LearnedName[],
  families?: GroupUnits | null,
): WhoView {
  const resolved = resolveIntentPeople(intent, members, { learned, picks: edit?.picks });
  const plan = buildVoiceSplit(resolved, {
    memberIds: members.map((member) => member.id),
    meMemberId: members.find((member) => member.isMe)?.id ?? null,
    amountMinor,
    families,
    members,
  });
  let { payerId, participants: participantIds, params } = plan;
  let problems = [...plan.problems];
  // One exact total cannot be spread over several expenses.
  if (params.kind === 'exact' && draftCount > 1) problems.push({ code: 'exact_sum_mismatch' });
  if (edit?.payerId) {
    payerId = edit.payerId;
    problems = problems.filter((problem) => problem.code !== 'payer_unresolved');
  }
  if (edit?.participantIds) {
    participantIds = edit.participantIds;
    params = EQUAL;
    problems = problems.filter(
      (problem) =>
        problem.code !== 'participant_unresolved' &&
        problem.code !== 'exact_sum_mismatch' &&
        problem.code !== 'percent_sum_mismatch' &&
        problem.code !== 'no_participants',
    );
    if (participantIds.length === 0) problems.push({ code: 'no_participants' });
  }
  if (edit?.params) {
    params = edit.params;
    problems = problems.filter(
      (problem) => problem.code !== 'exact_sum_mismatch' && problem.code !== 'percent_sum_mismatch',
    );
    // Set against one amount: still has to add up to the amount as it stands.
    if (params.kind === 'exact') {
      const sum = Object.values(params.amounts).reduce((total, value) => total + value, 0n);
      if (draftCount > 1 || (amountMinor !== null && sum !== amountMinor))
        problems.push({ code: 'exact_sum_mismatch' });
    }
  }
  return {
    intent: resolved,
    payerId,
    participantIds,
    params,
    problems,
    edited:
      edit?.payerId !== undefined ||
      edit?.participantIds !== undefined ||
      edit?.params !== undefined,
  };
}

/** A plain icon button in the header (the ✕, the keypad): no circle behind it. */
function IconButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

export default function VoiceScreen() {
  const labelOf = useGroupLabeller();
  const theme = useTheme();
  // Your own name, for the destination row: the picker offers "me" as your
  // portrait and name, and the folded selector has to say the same thing back.
  const viewer = useViewerIdentity();
  // The one canonical insets: the header clears the status bar and the footer
  // clears the navigation bar, each added once, here.
  const insets = useSafeAreaInsets();
  const { t, locale } = useStrings();

  // Identity for "which member am I", from the session rather than the profile:
  // the session is on the device at launch, the profile is a fetch that lands
  // later, and in the gap `profile?.id` is undefined — which `isViewer` refuses
  // to match, but only if it is given the right thing to compare. See
  // `lib/auth.useViewerId`.
  const viewerId = useViewerId();
  const dc = useDefaultCurrency();
  // The reader's categories (custom tags included), for the preview's label.
  const { visible: categoryCatalog } = useLabelledCategoryCatalog();
  const groups = useGroups();
  /** A debt in a currency its group does not settle in, in a group that settles
   *  in its own currency: a bill with no rate yet, not something to pay. An
   *  unknown group answers true — hold back rather than guess. */
  const ratelessDebt = (groupId: string | null, currency: string): boolean => {
    const group = groupId ? (groups.data ?? []).find((row) => row.id === groupId) : undefined;
    if (!group) return true;
    return isRatelessTransfer(
      { currency },
      group.default_currency,
      group.convert_to_group_currency === true,
    );
  };
  // Opened from a group's own screens (the raised mic passes its id), so a
  // spoken expense lands in that group by default rather than the unassigned
  // inbox. The reader can still switch the destination on the review; and a
  // sentence that names a different group ("…for the Goa trip") still wins.
  const params = useLocalSearchParams<{
    group?: string;
    heard?: string;
    hn?: string;
    /** `personal`: opened from the private ledger, so a spoken expense stays private. */
    scope?: string;
    /** How the screen was reached, for the opened event (`typed` opens the composer). */
    source?: string;
  }>();
  const launchGroupId = typeof params.group === 'string' ? params.group : null;
  const launchPersonal = params.scope === 'personal' && !launchGroupId;
  // A transcript captured by the home-screen voice widget's own recogniser and
  // handed in on the deep link — the mic already ran outside the app, so this
  // screen skips listening and goes straight to interpreting it (see the effect
  // below). `hn` is a per-tap nonce so a fresh widget capture re-runs on a warm
  // screen that already consumed an earlier one.
  const widgetHeard = typeof params.heard === 'string' ? params.heard.trim() : '';

  const createCapture = useCreateCapture();
  const createGroup = useCreateGroup();
  const upsertPersonal = useUpsertPersonalRecord();
  // "Who is in this" for every group I am in — used to tell whether a set of
  // selected people already share a group (assign to it) or not (make one).
  const signatures = useGroupPeopleSignatures(viewerId);
  // Existing people, by name, so a spoken expense can be pointed at an
  // individual — not only a group. Each is a pairwise balance the viewer has;
  // the ones explained by a single group (`only_group_id`) are their 1:1 group,
  // which the picker reuses. Computed from the mirror, so it works offline.
  const people = usePeopleBalances(viewerId);
  // Groups that are a true 1:1 (you + one other) — these are the People-tab
  // contacts, and the only groups the Groups tab hides. A multi-person group is
  // never treated as a person, even when it is your sole shared group with
  // someone, so it always stays listed under Groups.
  const oneToOne = useOneToOneGroupIds();
  const peopleChoices: SaveToPerson[] = (() => {
    const byGroup = new Map<string, SaveToPerson>();
    for (const row of people.data ?? []) {
      // A contact is a real 1:1 group, not merely the one group you happen to
      // share with them — otherwise a whole trip would masquerade as a person.
      if (!row.only_group_id || !oneToOne.data.has(row.only_group_id)) continue;
      // One entry per 1:1 group (a person has one row per currency); newest name
      // wins, which is fine — they share a display name.
      byGroup.set(row.only_group_id, {
        personKey: row.person_key,
        name: row.display_name,
        groupId: row.only_group_id,
        avatarUrl: row.avatar_url,
        isGhost: row.is_ghost,
      });
    }
    return [...byGroup.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  // 'listening' → the mic; 'thinking' → the model is reading; 'review' → the
  // heard expenses, editable, awaiting a destination and a Save; 'committing' →
  // a confident command is writing itself after a short Undo window (see
  // {@link voiceAutoAction}), the banner counting down over the review; 'answer'
  // → a read-only balance question, its answer shown (nothing written).
  // The scroll view's own height and its content's, so the capture surface
  // scrolls only when it does not fit (see the ScrollView below).
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [phase, setPhase] = useState<
    'listening' | 'thinking' | 'review' | 'committing' | 'answer' | 'agent' | 'saved'
  >(widgetHeard ? 'thinking' : 'listening');
  // Pro advanced voice (flag `voice_agent`): when on, the mic streams to Deepgram
  // and the live transcript goes to the agent (phase 'agent') instead of straight
  // to the on-device parser. Off, none of this runs and the screen behaves as it always has.
  const {
    enabled: agentServerOn,
    ready: agentStatusReady,
    lastKnown: agentLastKnown,
  } = useVoiceAgentStatus();
  // Nothing streams until the person has agreed to send their voice to the
  // third-party AI (Apple 5.1.2(i)): the sheet below asks once, and "Not now"
  // keeps this visit on the on-device voice.
  const voiceConsent = useVoiceConsent(viewerId);
  const [consentDeclined, setConsentDeclined] = useState(false);
  // The typed composer replaces the mic on this same screen: a keyboard glyph
  // under the mic opens it, and its mic glyph brings the mic back.
  const [typedMode, setTypedMode] = useState(params.source === 'typed');
  const [typedDraft, setTypedDraft] = useState('');
  const lastTyped = useRef('');
  // The last sentence handed to be read — spoken or typed — so the processing
  // step and the preview can show what was heard, and Edit can correct it.
  const [heardText, setHeardText] = useState('');
  // Where the Pro agent's panel is, reported by it, for the stage above it.
  const [agentStage, setAgentStage] = useState<AgentStage>('working');
  // The agent panel's own footer button (Add, Add all, or Done), reported up.
  const [panelFooter, setPanelFooter] = useState<FooterSpec | null>(null);
  // The single expense's editor is open (a tap on the preview); Save finishes it.
  const [editingDraft, setEditingDraft] = useState(false);
  // The optional Details (category, date, place) are unfolded.
  const [detailsOpen, setDetailsOpen] = useState(true);
  // The whole flow stays on this screen: a save lands here, on a compact
  // success state with Add another and Done, and the follow-up questions run
  // right under it. `expense` carries what the follow-ups need.
  const [savedResult, setSavedResult] = useState<
    | { kind: 'expense'; line: string; state: SavedState; write: AgentExpenseWrite | null }
    | { kind: 'line'; line: string }
    | null
  >(null);
  const [savedHandoff, setSavedHandoff] = useState<UndoEntry | null>(null);
  // The split sheet (who paid, how it splits) over the review, and whether the
  // payer/people plan is shown for a sentence that named nobody.
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitView, setSplitView] = useState<'people' | 'payer'>('people');
  const [whoForced, setWhoForced] = useState(false);
  // The reader's groups and people from the local mirror, for the follow-ups.
  const agentLocal = useAgentLocalData(viewerId);
  const reduceMotion = useReducedMotion();
  // One save at a time: a double tap on Add expense, or the auto-commit timer
  // racing a tap, is refused synchronously rather than writing twice.
  const [saveGate] = useState(singleFlight);
  // Free sees a once-a-week teaser where Pro would be asked a follow-up.
  // Not yet known counts as Pro: a paid person is never shown a teaser because a
  // read was slow.
  const entitlement = useEntitlement();
  const isPro = entitlement.isPro || entitlement.loading;
  // Which path read the last command, for the `assistant_command` event.
  const commandPath = useRef<'fast' | 'agent'>('fast');
  const reportCommand = (
    outcome: 'confirmed' | 'discarded' | 'clarified' | 'failed',
    scope: AssistantScope,
    path: 'fast' | 'agent' = commandPath.current,
  ): void => trackAssistant('assistant_command', { path, outcome, scope });
  // One `assistant_opened` per visit: how the person got here, as an enum word.
  const openedReported = useRef(false);
  useEffect(() => {
    if (openedReported.current) return;
    openedReported.current = true;
    const pushed = pushToTalk.getSnapshot();
    const fromParam =
      params.source === 'typed' || params.source === 'quick' || params.source === 'personal'
        ? params.source
        : null;
    trackAssistant('assistant_opened', {
      source:
        fromParam ??
        (launchPersonal
          ? 'personal'
          : widgetHeard
            ? 'quick'
            : pushed.holding || pushed.ended
              ? 'hold'
              : 'mic'),
    });
    // Once per visit, from whatever the route said at the start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cloudConsent: VoiceCloudConsent =
    voiceConsent.state === 'granted'
      ? 'granted'
      : voiceConsent.state === 'revoked'
        ? 'revoked'
        : 'pending';
  const agentOn = agentServerOn && cloudConsent === 'granted';
  // Pro and the Pro trial stream the mic live to Deepgram. Free — including
  // commands earned with a reward ad — listens on the phone and sends the text to
  // the agent: the same cloud model at about a seventh of the cost per command.
  // The server refuses a Free stream too, so this is only what the app asks for.
  const streamsToCloud = useVoiceStreamsToCloud();
  const phoneToAgent = agentOn && !streamsToCloud;
  // At the monthly limit a Free person may choose to watch one reward ad (the
  // server decides who is offered it; nobody else sees anything).
  const adOffer = useRewardedAdOffer();
  const agentReady = agentStatusReady && voiceConsent.ready;
  const consentSheetOpen =
    agentServerOn && voiceConsent.ready && voiceConsent.state === 'needed' && !consentDeclined;
  // Which engine heard the capture — its pill shows only while listening.
  const [, setEngine] = useState<VoiceEngineInfo | null>(null);
  // The agent's open question and what prompted it, while the next clip is its
  // answer; cleared once that answer has been read.
  const [agentFollowUp, setAgentFollowUp] = useState<{
    transcript: string;
    question: string;
  } | null>(null);
  // Bumped when a tapped option answers the question, so the panel starts afresh.
  const [agentRun, setAgentRun] = useState(0);
  const [agentSession, setAgentSession] = useState<{
    transcript: string;
    alternatives: readonly string[];
  } | null>(null);
  // The agent's allowance was spent, so the basic path took over — said once.
  const [agentQuotaNote, setAgentQuotaNote] = useState(false);
  // The answer shown in the 'answer' phase. `text` is a ready line (a person
  // balance, or "couldn't find X"); `group` is answered live from the group's
  // ledger once it loads, since that read is async.
  const [owedLoading, setOwedLoading] = useState(true);
  const [answer, setAnswer] = useState<
    | { kind: 'text'; text: string }
    | { kind: 'group'; groupName: string; currency: string }
    | { kind: 'owed'; direction: 'owed' | 'owe' }
    | { kind: 'spend'; query: SpendQuery }
    | null
  >(null);
  // The group a balance question is about — read by the ledger hook below.
  const [queryGroupId, setQueryGroupId] = useState('');
  // The auto-act banner shown during 'committing': the line to read and whether
  // Undo drops to the review (a single expense to edit) or back to the mic (a
  // bare create-group, nothing to review). Cleared the moment the window ends.
  const [autoBanner, setAutoBanner] = useState<{
    label: string;
    fallback: 'review' | 'listening';
    /** Held for an explicit Confirm instead of a timer: the words came in on a
        link, not from this person's own mic. */
    needsConfirm?: boolean;
  } | null>(null);
  // What the next transcript does — set the moment the mic is opened (opening
  // capture, "add more", or a single row's re-dictation), read when it returns.
  const [micMode, setMicMode] = useState<MicMode>('replace');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [voicePeopleText, setVoicePeopleText] = useState<string | null>(null);
  const [voiceSplitCount, setVoiceSplitCount] = useState<number | null>(null);
  const [voiceExpenseDate, setVoiceExpenseDate] = useState<string | null>(null);
  // Who paid, which group and how it divides, as spoken. Read against the chosen
  // group's members below, so the review can show it and Save can write it.
  const [intent, setIntent] = useState<VoiceIntent | null>(null);
  // The reader's corrections to the payer and the people, laid over the spoken
  // intent. Dropped whenever a new sentence or a different group comes in.
  const [whoEdit, setWhoEdit] = useState<WhoEdit | null>(null);
  // A spoken group name that fit nothing, or several groups, stays flagged until
  // the reader picks a destination themselves.
  const [groupChosen, setGroupChosen] = useState(false);
  // One place for the whole spoken batch — a run of "coffee, then the taxi" all
  // happened where you are standing (A43). The current place is read on its own
  // when the review opens and pinned by default; the reader can still clear or
  // move it. A spoken expense is nearly always logged on the spot, so filing it
  // there without a tap is the point.
  const [location, setLocation] = useState<ExpenseLocation | null>(null);
  const [dest, setDest] = useState<Dest>({ kind: 'unassigned' });
  // The destination folds into a single row that opens this sheet, so the
  // expenses — not a wall of group rows — are the first thing on the review.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noAmount, setNoAmount] = useState(false);
  // The words were typed but held no amount: put them back to be fixed, as the
  // mic would have offered another try.
  useEffect(() => {
    if (noAmount && typedMode && lastTyped.current) setTypedDraft(lastTyped.current);
  }, [noAmount, typedMode]);
  const [error, setError] = useState<string | null>(null);
  // The mic panel's state for the fixed top area, while listening.
  const [capStage, setCapStage] = useState<CaptureStage | null>(null);
  const [saving, setSaving] = useState(false);
  // Remounts the mic to start a fresh utterance after a miss.
  const [attempt, setAttempt] = useState(0);
  // The "make a new group" the sentence asked for, kept apart from the current
  // destination so its row stays selectable after the reader picks the inbox or
  // an existing group instead.
  const [requested, setRequested] = useState<{
    groupId: string;
    memberId: string;
    name: string;
  } | null>(null);
  // A new group is created once, not again on a save retry after a partial
  // failure. Flipped true after the create lands; reset when a fresh parse comes.
  const groupCreated = useRef(false);
  /** The currency the new group was made in, fixed for any retry after an edit. */
  const [createdGroupCurrency, setCreatedGroupCurrency] = useState<string | null>(null);
  // The ghosts for the brand-new people, minted once on the first save (one per
  // name) and reused on a retry, so a partial failure adds no second set. Reset
  // with a fresh parse or a change of destination.
  const ghostMemberIds = useRef<string[] | null>(null);
  // The pending auto-commit timer, so Undo (or a fresh parse, or unmount) can
  // cancel the write before it fires. Holds a real id only during 'committing'.
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest `save`, kept in a ref so the auto-commit timer runs the current
  // one — reading the destination and drafts as they stand when the window ends,
  // not as they were when the timer was armed.
  const commitRef = useRef<(() => Promise<void>) | null>(null);
  // A Save (or a close that persists the batch as a draft) has already taken
  // over navigation — so the leave-guard below stands aside instead of writing
  // the captures a second time.
  const committed = useRef(false);
  // The transcript being interpreted arrived on a `waves://voice?heard=` link
  // rather than from the mic on this screen. Anything can open that link — a web
  // page, a chat message — so its words are never allowed to write on a timer:
  // a "settle up with Ravi" planted in a link would otherwise record a
  // settlement unless the reader hit Undo within four seconds. Cleared the
  // moment the reader starts a capture of their own.
  const heardFromLink = useRef(false);
  // A write from the armed command is in flight.
  const autoRunning = useRef(false);
  // The review reads the current location once per batch and pins it. Latched so
  // the read fires once (not on every render, and not again after the reader
  // clears or moves the pin); reset when a fresh parse opens a new review.
  const autoLocated = useRef(false);
  // Guards the async read from clobbering a later truth. `locationGen` ticks once
  // per parsed batch, so a fix arriving after a new utterance is dropped;
  // `locationTouched` flips the moment the reader sets or clears the pin by hand,
  // so an in-flight read never overrides their choice.
  const locationGen = useRef(0);
  const locationTouched = useRef(false);
  // One interpretation at a time. Bumped when a capture is sent to be read, and
  // again the moment the reader backs out of the 'thinking' phase — so a result
  // that lands after they have returned to the review (a cancelled append) is
  // dropped rather than mutating the batch they went back to.
  const interpretToken = useRef(0);
  // True only while a mic capture the reader actually started is live. The mic's
  // `abort()` on unmount (a dismiss, or the switch back to the review) fires a
  // final `end` that calls `onDone` with the last transcript — so a dismissed
  // capture would otherwise still append its words to a row or replace the batch.
  // Set on every real listen start (via `onListen`), cleared on dismiss and the
  // moment a transcript is consumed, so a post-dismiss `onDone` is ignored.
  const captureActive = useRef(false);

  const navigation = useNavigation();

  const groupRows = useMemo(() => groups.data ?? [], [groups.data]);
  const groupRefs: VoiceGroupRef[] = groupRows.map((group) => ({
    id: group.id,
    name: group.name,
    currency: group.default_currency,
  }));
  // The reader's own group names, for the "Try saying…" example card.
  const groupNames = groupRows.map((group) => group.name ?? '').filter(Boolean);
  // Names this reader confirmed on earlier reviews, per group, on this phone.
  const nameMemory = useVoiceNameMemory(viewerId);
  const everyMember = useAllGroupMembers();

  // Members and currency of the chosen group, read from the local mirror. Empty
  // id (the unassigned/create cases) reads nothing, which is what we want. A
  // settle also needs the group's members — my own member id is read from them.
  const targetGroupId =
    dest.kind === 'existing' || dest.kind === 'settle' || dest.kind === 'add-member'
      ? dest.groupId
      : '';
  const target = useGroup(targetGroupId);
  // The group the mic was opened in: its members let the parser tell a person
  // from a description ("for Arjun" vs "for dinner") while the sentence is read.
  const launchGroup = useGroup(launchGroupId ?? '');
  const launchMembers = useMemo(
    () =>
      launchGroupId
        ? withAliases(toCandidates(launchGroup.members.data, viewerId), nameMemory, launchGroupId)
        : undefined,
    [launchGroupId, launchGroup.members.data, viewerId, nameMemory],
  );
  // What the recogniser is told to listen for: the people this sentence may
  // name — the launch group's, else everybody across the reader's groups —
  // by display name, first name and confirmed alias (capped in voiceNameHints).
  const hints = useMemo(() => {
    if (launchMembers) return voiceNameHints(launchMembers);
    const aliased = groupRows.flatMap((group) =>
      withAliases(
        toCandidates(
          everyMember.filter((member) => member.group_id === group.id),
          viewerId,
        ),
        nameMemory,
        group.id,
      ),
    );
    return voiceNameHints(aliased);
  }, [launchMembers, groupRows, everyMember, viewerId, nameMemory]);
  // Only the group destinations carry a group id to write into; unassigned and
  // "just me" have none, so the write hook reads the empty id and stays inert.
  const writeGroupId =
    dest.kind === 'existing' || dest.kind === 'create' || dest.kind === 'people'
      ? dest.groupId
      : '';
  const writeExpense = useWriteExpense(writeGroupId);
  // Bound to the new people's minted group id (a `people` batch) or the target
  // of a spoken "add Ravi to …"; inert (empty id) in every other case.
  const addGhost = useAddGhostMember(
    dest.kind === 'people' || dest.kind === 'add-member' ? dest.groupId : '',
  );
  // A spoken settle-up records against the person's 1:1 group; inert otherwise.
  const recordSettlement = useRecordSettlement(dest.kind === 'settle' ? dest.groupId : '');
  // The ledger behind a spoken "what's my balance in <group>". Empty id (no such
  // question pending) reads nothing, so it stays inert until one is asked.
  const queryLedger = useGroupLedger(queryGroupId, viewerId);
  // "How much did I spend on food this month": answered on the phone, from the
  // personal ledger plus my share of group expenses.
  const moneyAnswerer = useAssistantAnswerer();

  // A confident command writes itself after this many ms, unless Undo is tapped.
  const AUTO_COMMIT_MS = 4000;

  // Arm the auto-act window: show the banner, hold in 'committing', and fire the
  // current `save` when it elapses. A fresh parse, Undo, or unmount cancels it.
  const beginAutoCommit = (banner: { label: string; fallback: 'review' | 'listening' }): void => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    setNoAmount(false);
    setPhase('committing');
    // Words from a link wait for a tap; only the reader's own voice acts alone.
    if (heardFromLink.current) {
      autoTimer.current = null;
      setAutoBanner({ ...banner, needsConfirm: true });
      return;
    }
    setAutoBanner(banner);
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      runAutoCommit(banner.fallback);
    }, AUTO_COMMIT_MS);
  };

  // Write the armed command — when the Undo window elapses, or on Confirm for
  // one that came in on a link.
  const runAutoCommit = (fallback: 'review' | 'listening'): void => {
    // A double tap on Confirm lands twice before the banner re-renders away;
    // one armed command is one write.
    if (autoRunning.current) return;
    autoRunning.current = true;
    setAutoBanner(null);
    void (async () => {
      try {
        await commitRef.current?.();
      } finally {
        autoRunning.current = false;
      }
      // save() navigates on success (committed=true). If it failed it set an
      // error and left us on the spinner — drop to the fallback so the error
      // is readable: the review (a batch to retry) or the mic (nothing to).
      if (committed.current) return;
      if (fallback === 'listening') {
        setRequested(null);
        setDest({ kind: 'unassigned' });
        setDrafts([]);
        setPhase('listening');
      } else {
        setPhase('review');
      }
    })();
  };

  // Undo the pending write. A single expense drops to the review so it can be
  // edited and saved by hand; a bare create-group has nothing to review, so it
  // goes back to the mic with the minted group discarded.
  const cancelAutoCommit = (): void => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = null;
    const fallback = autoBanner?.fallback ?? 'review';
    hapticLight();
    reportCommand('discarded', dest.kind === 'me' ? 'personal' : 'group');
    setAutoBanner(null);
    if (fallback === 'listening') {
      setRequested(null);
      setDest({ kind: 'unassigned' });
      setDrafts([]);
      setPhase('listening');
    } else {
      setPhase('review');
    }
  };

  // A tap on one of the groups a spoken name could have meant.
  const chooseGroup = (groupId: string): void => {
    groupCreated.current = false;
    ghostMemberIds.current = null;
    setRequested(null);
    setDest({ kind: 'existing', groupId });
    setGroupChosen(true);
    setWhoEdit(null);
  };

  // Reset the per-parse bookkeeping — a fresh parse is a fresh group to create,
  // fresh ghosts to mint, and a fresh location to read.
  const resetForNewParse = (): void => {
    setWhoForced(false);
    groupCreated.current = false;
    ghostMemberIds.current = null;
    autoLocated.current = false;
    locationGen.current += 1;
    locationTouched.current = false;
    setLocation(null);
  };

  const applyResult = (result: VoiceParseResult): void => {
    const auto = voiceAutoAction(result);

    // A bare "make a group called X" carries no amount, so it would trip the
    // no-amount guard below. Handle it first: mint the group and auto-create it
    // after the Undo window, with no expense to write and nothing to review.
    if (auto?.kind === 'create-group') {
      const created = { groupId: randomUUID(), memberId: randomUUID(), name: auto.name };
      resetForNewParse();
      setDrafts([]);
      setVoicePeopleText(null);
      setVoiceSplitCount(null);
      setVoiceExpenseDate(null);
      setIntent(null);
      setWhoEdit(null);
      setRequested(created);
      setDest({ kind: 'create', ...created });
      beginAutoCommit({
        label: t.voice.autoCreating.replace('{name}', auto.name),
        fallback: 'listening',
      });
      return;
    }

    if (result.items.length === 0) {
      setNoAmount(true);
      setAttempt((current) => current + 1);
      setPhase('listening');
      return;
    }
    setDrafts(toDrafts(result));
    setVoicePeopleText(result.peopleText);
    setVoiceSplitCount(result.splitCount);
    setVoiceExpenseDate(result.expenseDate);
    setIntent(result.intent);
    setWhoEdit(null);
    setGroupChosen(false);
    resetForNewParse();
    // Default the destination to what was heard: a new group to make, an
    // existing group named, else the capture inbox.
    if (result.group?.kind === 'create') {
      const created = { groupId: randomUUID(), memberId: randomUUID(), name: result.group.name };
      setRequested(created);
      setDest({ kind: 'create', ...created });
    } else if (result.group?.kind === 'existing') {
      setRequested(null);
      setDest({ kind: 'existing', groupId: result.group.groupId });
    } else if (
      result.intent &&
      (result.intent.groupSource === 'ambiguous' || result.intent.groupSource === 'unresolved')
    ) {
      // A group was named but is not clearly one of theirs. Not the launch group,
      // not a guess: the inbox, with the question shown, until they choose.
      setRequested(null);
      setDest({ kind: 'unassigned' });
    } else if (result.personal || launchPersonal) {
      // "Just for me" — a private expense on the Me ledger. This beats the
      // launch-group context below: an explicit solo marker is a clear choice.
      setRequested(null);
      setDest({ kind: 'me' });
    } else if (
      launchGroupId &&
      (groups.data == null || groupRows.some((group) => group.id === launchGroupId))
    ) {
      // No group named in the sentence, but the mic was opened from a group —
      // default to it. The id came from a real group route, so it is trusted
      // while the group mirror is still loading (`groups.data` null): a
      // transcript that resolves before hydration must not fall to the inbox and
      // then never re-evaluate. Once the mirror has loaded, a stale id (a group
      // left or deleted since the screen opened) is no longer among the rows and
      // falls through to the inbox below.
      setRequested(null);
      setDest({ kind: 'existing', groupId: launchGroupId });
    } else {
      setRequested(null);
      setDest({ kind: 'unassigned' });
    }
    setNoAmount(false);

    // Confident single expense to an existing, named group — write it after a
    // short Undo window rather than asking for a tap that would only confirm the
    // group's own currency and an equal split (the defaults the review applies).
    // Only when the group has a name to show, so the banner can say where it
    // lands; an unnamed 1:1 falls to the review instead.
    if (auto?.kind === 'commit-expense') {
      const groupName = groupRows.find((group) => group.id === auto.groupId)?.name?.trim();
      if (groupName) {
        const item = result.items[0];
        const currency = item.currency ?? dc;
        beginAutoCommit({
          label: t.voice.autoAdding
            .replace('{amount}', `${item.amountMajor} ${currency}`)
            .replace('{group}', groupName),
          fallback: 'review',
        });
        return;
      }
    }

    setPhase('review');
  };

  // The heard batch, read by the pure heuristic — amounts, currencies, a named
  // group, several expenses in a breath, a spoken new group, "just for me".
  const interpret = useCallback(
    async (transcript: string, alternatives?: readonly string[]): Promise<VoiceParseResult> => {
      const final = parseVoiceExpenses(transcript, groupRefs, {
        members: launchMembers,
        families: launchGroup.group.data?.units,
        currentGroupId: launchGroupId,
        alternatives,
        learned: learnedForGroup(nameMemory, launchGroupId),
      });
      // Report what was heard when nothing usable came back, so the parser can be
      // improved against a real miss. Best-effort: the lib decides whether to send
      // (only failures, only with consent) and never throws — see lib/voiceLog.
      void logVoiceAttempt({
        transcript,
        itemCount: final.items.length,
        usedModel: false,
        locale,
      });
      return final;
    },
    [groupRefs, locale, launchMembers, launchGroupId, nameMemory, launchGroup.group.data?.units],
  );

  // Drafts minted from heard expenses — the shared shape for the opening batch
  // and the appended ones, so an added expense reads and saves exactly like an
  // original (same category-less default, same batch folding at save time).
  // The amount reading belongs to the one expense it was read for; with several,
  // only an open currency question (a bare "dollars") applies to every row.
  const toDrafts = (result: VoiceParseResult): Draft[] =>
    result.items.map((item) => ({
      key: randomUUID(),
      amount: String(item.amountMajor),
      note: item.note,
      currency: item.currency,
      category: item.category,
      amountReading:
        result.items.length === 1 ||
        (item.currency !== null && result.amount?.currencyOptions.includes(item.currency))
          ? result.amount
          : null,
      amountAnswered: false,
      currencyAnswered: false,
    }));

  const editDraft = (key: string, patch: Partial<Draft>): void => {
    // Typing the amount in by hand answers the row's amount question too.
    const answered = patch.amount !== undefined ? { amountAnswered: true } : null;
    setDrafts((current) =>
      current.map((draft) => (draft.key === key ? { ...draft, ...answered, ...patch } : draft)),
    );
  };
  const removeDraft = (key: string): void => {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
  };

  // "+ Add more": the heard expenses are pushed onto the current list, keeping
  // every existing row and the chosen destination. A miss (nothing with an
  // amount) drops back to the mic in the same append mode, so the retry still
  // appends rather than silently replacing the batch.
  const appendResult = (result: VoiceParseResult): void => {
    if (result.items.length === 0) {
      setNoAmount(true);
      setAttempt((current) => current + 1);
      setPhase('listening');
      return;
    }
    setDrafts((current) => [...current, ...toDrafts(result)]);
    if (result.peopleText) setVoicePeopleText(result.peopleText);
    if (result.splitCount !== null) setVoiceSplitCount(result.splitCount);
    if (result.expenseDate) setVoiceExpenseDate(result.expenseDate);
    if (result.intent?.hasSocialDetail) {
      setIntent(result.intent);
      setWhoEdit(null);
    }
    setNoAmount(false);
    setMicMode('replace');
    setPhase('review');
  };

  // A spoken money-movement command — "settle up with Ravi", "remind Priya" —
  // rather than an expense. Resolves the named person against the reader's 1:1
  // contacts and, when exactly one fits and the balance makes the action mean
  // something, arms the auto-act window for it. Returns true when it took the
  // command; false leaves the sentence to the ordinary expense parse. The one
  // thing that acts without a review is still cancellable for 4s (Undo), which
  // is what makes a money-out or an outward nudge safe to trigger by voice.
  const tryMoneyIntent = (transcript: string): boolean => {
    const intent = detectMoneyIntent(transcript);
    if (!intent) return false;
    // A debt in a currency the group does not settle in comes from a bill with
    // no rate yet (ADR-003 amendment): it cannot be settled or reminded about,
    // so it is never a candidate here — the Settle up screen offers its rate.
    const payable = (row: { only_group_id: string | null; currency: string }): boolean =>
      !ratelessDebt(row.only_group_id, row.currency);

    // Only true 1:1 contacts can be settled or reminded — the same rows the
    // People picker offers. A name must match exactly one of them.
    const rows = (people.data ?? []).filter(
      (row) => row.only_group_id && oneToOne.data.has(row.only_group_id),
    );
    const contacts = [
      ...new Map(rows.map((row) => [row.person_key, row.display_name])).entries(),
    ].map(([id, name]) => ({ id, name }));
    const matched = matchMemberNames(intent.who, contacts);
    if (matched.length !== 1) return false;
    const personKey = matched[0];
    const personRows = rows.filter((row) => row.person_key === personKey);
    const name = personRows[0]?.display_name ?? '';

    if (intent.kind === 'remind') {
      // A nudge only means something when they owe me — in exactly one currency,
      // so there is one unambiguous debt to point at.
      const owing = personRows.filter(
        (row) => BigInt(row.net) > 0n && row.only_group_id && payable(row),
      );
      if (owing.length !== 1) return false;
      const row = owing[0];
      setRequested(null);
      setDest({
        kind: 'remind',
        groupId: row.only_group_id as string,
        toMemberId: row.member_id,
        currency: row.currency,
        name,
      });
      beginAutoCommit({
        label: t.voice.autoReminding.replace('{name}', name),
        fallback: 'listening',
      });
      return true;
    }

    // Settle: one non-zero balance to clear (either direction), one currency.
    const owed = personRows.filter(
      (row) => BigInt(row.net) !== 0n && row.only_group_id && payable(row),
    );
    if (owed.length !== 1) return false;
    const row = owed[0];
    const net = BigInt(row.net);
    const iPay = net < 0n;
    const whole = net < 0n ? -net : net;
    // A spoken partial ("settle 200 with Ravi") never exceeds what is owed.
    const spoken = intent.amount != null ? toVoiceMinorUnits(intent.amount, row.currency) : null;
    const amount = spoken != null && spoken < whole ? spoken : whole;
    if (amount <= 0n) return false;
    const major = Number(amount) / Number(minorUnitScale(row.currency));
    setRequested(null);
    setDest({
      kind: 'settle',
      groupId: row.only_group_id as string,
      toMemberId: row.member_id,
      amount,
      currency: row.currency,
      iPay,
      name,
    });
    beginAutoCommit({
      label: t.voice.autoSettling
        .replace('{amount}', `${major} ${row.currency}`)
        .replace('{name}', name),
      fallback: 'listening',
    });
    return true;
  };

  // A spoken "add Ravi to the latest group" — add a ghost (or several) to an
  // existing group by name. The group is resolved by the ordinary parse (a named
  // or relative one); a group that does not resolve, or an unnamed one with no
  // label to show, falls through to the expense parse rather than guessing.
  const tryAddMember = (transcript: string): boolean => {
    const add = detectAddMember(transcript);
    if (!add) return false;
    const parsed = parseVoiceExpenses(transcript, groupRefs);
    if (parsed.group?.kind !== 'existing') return false;
    const groupId = parsed.group.groupId;
    const groupName = groupRows.find((group) => group.id === groupId)?.name?.trim();
    if (!groupName) return false;
    setRequested(null);
    setDest({ kind: 'add-member', groupId, names: add.names, groupName });
    const who = add.names.join(', ');
    beginAutoCommit({
      label: t.voice.autoAddingPerson.replace('{name}', who).replace('{group}', groupName),
      fallback: 'listening',
    });
    return true;
  };

  // A spoken read-only question — "how much does Ravi owe me", "what's my
  // balance in Goa". Nothing is written: the number is looked up and shown on an
  // answer card. A person is resolved against the reader's 1:1 contacts; a group
  // question is resolved by the ordinary parse and answered from its ledger. An
  // overall directional question is grouped with separate currency totals.
  // Returns true when it took and answered the question.
  const tryBalanceQuery = (transcript: string): boolean => {
    const query = detectBalanceQuery(transcript);
    if (!query) return false;

    const fmt = (minor: bigint, currency: string): string =>
      `${Number(minor) / Number(minorUnitScale(currency))} ${currency}`;

    if (query.kind === 'person') {
      const rows = (people.data ?? []).filter(
        (row) => row.only_group_id && oneToOne.data.has(row.only_group_id),
      );
      const contacts = [
        ...new Map(rows.map((row) => [row.person_key, row.display_name])).entries(),
      ].map(([id, name]) => ({ id, name }));
      const matched = matchMemberNames(query.who, contacts);
      if (matched.length !== 1) {
        setAnswer({ kind: 'text', text: t.voice.ansNoPerson.replace('{name}', query.who) });
        setPhase('answer');
        return true;
      }
      const personRows = rows.filter((row) => row.person_key === matched[0]);
      const name = personRows[0]?.display_name ?? query.who;
      // The currency with the biggest balance is the headline; a person with no
      // open balance in any currency reads as settled.
      const top = personRows
        .map((row) => {
          const net = BigInt(row.net);
          return { row, net, mag: net < 0n ? -net : net };
        })
        .sort((a, b) => (b.mag > a.mag ? 1 : b.mag < a.mag ? -1 : 0))[0];
      if (!top || top.mag === 0n) {
        setAnswer({ kind: 'text', text: t.voice.ansSettled.replace('{name}', name) });
      } else {
        const amount = fmt(top.mag, top.row.currency);
        setAnswer({
          kind: 'text',
          text:
            top.net > 0n
              ? t.voice.ansTheyOweYou.replace('{name}', name).replace('{amount}', amount)
              : t.voice.ansYouOwe.replace('{name}', name).replace('{amount}', amount),
        });
      }
      setPhase('answer');
      return true;
    }

    // A group balance question — resolve the group the ordinary way. Overall
    // directional questions use the live owed card; other questions fall through.
    const parsed = parseVoiceExpenses(transcript, groupRefs);
    if (parsed.group?.kind !== 'existing') {
      const direction = detectOwedDirection(transcript);
      if (!direction) return false;
      setAnswer({ kind: 'owed', direction });
      setPhase('answer');
      return true;
    }
    const groupId = parsed.group.groupId;
    const group = groupRows.find((candidate) => candidate.id === groupId);
    const groupName = group?.name?.trim();
    if (!groupName) return false;
    setQueryGroupId(groupId);
    setAnswer({ kind: 'group', groupName, currency: group?.default_currency ?? dc });
    setPhase('answer');
    return true;
  };

  // A spoken question about the person's own spend. The server cannot see the
  // personal ledger, so this is answered here, offline, before the agent is
  // asked (and without spending an allowance). Returns true when it took it.
  const tryMoneyQuestion = (transcript: string): boolean => {
    const query = moneyAnswerer.parse(transcript);
    if (!query) return false;
    setAnswer({ kind: 'spend', query });
    setPhase('answer');
    return true;
  };

  // What the fast path may resolve names against: the same 1:1 contacts the
  // settle/remind/balance paths use, and the members of the launch group (the
  // only group whose members are loaded before one is chosen).
  const fastPathContext = (alternatives: readonly string[]): FastPathContext => {
    const rows = (people.data ?? []).filter(
      (row) => row.only_group_id && oneToOne.data.has(row.only_group_id),
    );
    const byPerson = new Map<string, { id: string; name: string; balances: bigint[] }>();
    for (const row of rows) {
      const entry = byPerson.get(row.person_key) ?? {
        id: row.person_key,
        name: row.display_name,
        balances: [],
      };
      const net = BigInt(row.net);
      if (net !== 0n) entry.balances.push(net);
      byPerson.set(row.person_key, entry);
    }
    return {
      groups: groupRefs,
      currentGroupId: launchGroupId,
      membersByGroup: launchGroupId && launchMembers ? { [launchGroupId]: launchMembers } : {},
      contacts: [...byPerson.values()],
      // The same evidence the basic path reads with, so a name it would only
      // suggest or ask about, or an amount it would ask about, is seen here too.
      alternatives,
      learnedByGroup: launchGroupId
        ? { [launchGroupId]: learnedForGroup(nameMemory, launchGroupId) }
        : {},
    };
  };

  // `info.alternatives` are the engine's other readings (n-best), when it gives
  // them: they let the parser ask "₹15 or ₹50?" or "Ravi or Rajiv?" instead of
  // guessing.
  const handleTranscript = (
    transcript: string,
    {
      streamed = false,
      alternatives = [],
      typed = false,
    }: Partial<VoiceDoneInfo> & { typed?: boolean } = {},
  ): void => {
    // Ignore a callback from a capture the reader has already dismissed: the
    // mic's abort-on-unmount emits a final `end` → `onDone`, and without this a
    // stale transcript would land after the dismiss. Consuming one live capture
    // also clears the flag, so a second `end` from the same abort cannot
    // double-apply.
    if (!captureActive.current) return;
    captureActive.current = false;
    setHeardText(transcript);
    setEditingDraft(false);
    setDetailsOpen(true);
    // A money question is never an expense and never needs the agent.
    if (
      micMode !== 'append' &&
      !agentFollowUp &&
      (tryMoneyQuestion(transcript) ||
        tryBalanceQuery(transcript) ||
        (() => {
          const owed = owedQuestionTranscript(transcript, alternatives, groupRefs);
          return owed !== null && tryBalanceQuery(owed);
        })())
    ) {
      // The cloud engine heard it, so the command counts like any fast-path one.
      if (streamed) void meterVoiceCommand({ transcript, locale, today: today() });
      return;
    }
    // A fresh opening capture that was streamed goes to the advanced agent; "add
    // another", a link-supplied sentence, or a capture that fell back to the
    // on-device recogniser stay on the basic path.
    // Typed text is a sentence like any other: the agent reads it when it is on
    // (whichever way the mic would have streamed), the on-device parser otherwise.
    // Fast path: when the instant on-device parser reads the sentence with full
    // confidence, skip the agent (no wait, no allowance spent) and show the
    // ordinary basic review. The speech still came from the cloud engine.
    // An answer to the agent's own question ("Answer") always goes back to the
    // agent with what prompted it — on its own it is half a sentence.
    const route = transcriptRoute({
      agentOn,
      streamed,
      phoneToAgent,
      typed,
      appending: micMode === 'append',
      heardFromLink: heardFromLink.current,
      answeringAgent: Boolean(agentFollowUp),
      localConfident: () => {
        const fastContext = fastPathContext(alternatives);
        return localParseIsConfident(parseLocally(transcript, fastContext), fastContext);
      },
    });
    if (route === 'fast') {
      if (__DEV__) console.log('[voice] path: local fast path (agent skipped)');
      setEngine(streamed ? CLOUD : typed ? local(null) : local('free'));
      runBasic(transcript, alternatives);
      // The stream was used, so the command counts: meter it without waiting.
      // A 402 changes nothing now (the review is up); the next start falls back.
      // A Free sentence read on the phone cost nothing, so it is not counted.
      if (streamed) void meterVoiceCommand({ transcript, locale, today: today() });
      return;
    }
    if (route === 'agent') {
      if (__DEV__) console.log('[voice] path: agent');
      commandPath.current = 'agent';
      if (typed) setEngine(CLOUD);
      setAgentSession({ transcript, alternatives });
      setPhase('agent');
      return;
    }
    runBasic(transcript, alternatives);
  };

  // The agent could not help (quota, offline, unavailable, a bad reply): carry
  // on with the same transcript on the basic parser, as if the flag were off.
  const agentFellBack = (reason: AgentFallbackReason): void => {
    const heard = agentSession?.transcript;
    const heardAlternatives = agentSession?.alternatives ?? [];
    setAgentSession(null);
    if (!heard) return;
    reportCommand('failed', 'personal', 'agent');
    setAgentQuotaNote(reason === 'quota');
    if (reason === 'quota') {
      setEngine(local('quota'));
      // The natural moment: the monthly limit was just hit. A Free person who is
      // eligible is offered one reward ad (never forced; the server decides).
      void adOffer.offer('voice');
    } else {
      // The call failed or timed out: offline when the phone says so, otherwise
      // the cloud was unavailable — the badge says which, honestly.
      void checkOnline().then((online) => setEngine(engineAfterAgentFailure(reason, online)));
    }
    runBasic(heard, heardAlternatives);
  };

  const runBasic = (transcript: string, alternatives: readonly string[] = []): void => {
    const mode = micMode;
    commandPath.current = 'fast';
    // A settle/remind/add-member command, or a read-only balance question, only
    // makes sense as a fresh utterance, never as an expense appended to a batch.
    // When one takes the utterance it drives its own phase (an auto-act window,
    // or an answer card), so there is nothing more to interpret here.
    if (
      mode !== 'append' &&
      (tryMoneyQuestion(transcript) ||
        tryMoneyIntent(transcript) ||
        tryAddMember(transcript) ||
        tryBalanceQuery(transcript))
    )
      return;
    if (isVoiceAssistantRequest(transcript)) {
      setHeardText(transcript);
      setNoAmount(true);
      setAttempt((current) => current + 1);
      setPhase('listening');
      return;
    }
    setPhase('thinking');
    const token = (interpretToken.current += 1);
    void (async () => {
      const parsed = await interpret(transcript, alternatives);
      // Dropped if the reader has since backed out of 'thinking' (which bumps the
      // token), or a newer capture superseded this one — a late append must not
      // land on the review they returned to.
      if (interpretToken.current !== token) return;
      if (mode === 'append') appendResult(parsed);
      else applyResult(parsed);
    })();
  };

  // A widget-supplied transcript: the voice widget captured speech on the home
  // screen and deep-linked it here, so feed it straight into the interpret
  // pipeline — no mic, no cold-launch-then-listen. Consumed once per nonce, so a
  // fresh widget tap on an already-open screen is re-read while a re-delivery of
  // the same intent (Android sends some twice) is dropped.
  const consumedHn = useRef<string | null>(null);
  useEffect(() => {
    if (!widgetHeard) return;
    const nonce = typeof params.hn === 'string' && params.hn ? params.hn : widgetHeard;
    if (consumedHn.current === nonce) return;
    consumedHn.current = nonce;
    captureActive.current = true;
    heardFromLink.current = true;
    setMicMode('replace');
    handleTranscript(widgetHeard);
    // handleTranscript is a fresh closure each render but reads live refs/state;
    // running it once per nonce is the whole intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetHeard, params.hn]);

  // The reader set or cleared the pin by hand. Latch it so a still-pending
  // auto-read cannot come back and overwrite their choice.
  const handleLocationChange = (next: ExpenseLocation | null): void => {
    locationTouched.current = true;
    setLocation(next);
  };

  // A set of people → the group they already share, if any. First match wins;
  // it only ever answers "these exact people already have a group together".
  const groupBySignature = useMemo(() => {
    const map = new Map<string, string>();
    for (const sig of signatures.data) {
      const key = peopleSignatureKey(sig.names);
      if (!map.has(key)) map.set(key, sig.groupId);
    }
    return map;
  }, [signatures.data]);

  // A multi-person choice on the People tab. If the selected people already
  // share a group, land the batch there; otherwise make a fresh group named
  // after them (WhatsApp-style) with a ghost each, on save. One person is the
  // 1:1 case and rides the same path — a lone name reuses their group if it
  // exists, else opens a new 1:1.
  const resolvePeople = (names: string[]): void => {
    const clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    if (clean.length === 0) return;
    groupCreated.current = false;
    ghostMemberIds.current = null;
    const match = groupBySignature.get(peopleSignatureKey(clean));
    if (match) {
      setDest({ kind: 'existing', groupId: match });
    } else {
      setDest({
        kind: 'people',
        groupId: randomUUID(),
        memberId: randomUUID(),
        name: clean.join(', '),
        ghostNames: clean,
      });
    }
    setPickerOpen(false);
  };

  // "+ Add another" — reopen the mic to speak another expense (or several). The
  // returning batch is appended, not replaced; the destination is untouched.
  const startAddMore = (): void => {
    setMicMode('append');
    setNoAmount(false);
    setAttempt((current) => current + 1);
    setPhase('listening');
  };

  // The ✕. An "add more" sub-capture opened over a review that already has a
  // batch — backing out of it returns to the review with the batch intact,
  // rather than leaving the screen. Otherwise it leaves as before (the
  // leave-guard below still files an unassigned batch as a draft on the way).
  const dismiss = (): void => {
    // Abandon any live capture: the mic's abort-on-unmount will fire a final
    // `onDone`, and this flag makes handleTranscript drop it.
    captureActive.current = false;
    // A sub-capture over an existing batch — the mic (listening) or its pending
    // interpretation (thinking). Either way, back out to the review with the
    // batch intact and cancel any interpretation still in flight, rather than
    // leaving the screen. The opening capture (no batch yet) leaves as before.
    if ((phase === 'listening' || phase === 'thinking') && drafts.length > 0) {
      interpretToken.current += 1;
      setNoAmount(false);
      setMicMode('replace');
      setPhase('review');
      return;
    }
    if (phase === 'review') reportCommand('discarded', dest.kind === 'me' ? 'personal' : 'group');
    router.back();
  };

  // Push-to-talk. The raised mic in the bottom bar can be held rather than
  // tapped, and holding it pushed this screen the instant the finger landed —
  // which is why the mic here is already listening by the time anybody reads
  // this. What the bar cannot do is end the sentence, because the recogniser is
  // on this side; so the gesture is left in a small store (`lib/pushToTalk`) and
  // picked up here.
  // The ending lives on the store rather than in local state, and the mic panel
  // clears it by taking it once it has acted. That way an ending is never
  // applied twice, and — because the store keeps it rather than firing it — a
  // hold short enough to finish before this screen mounted is still picked up on
  // arrival instead of being missed.
  const hold = useSyncExternalStore(pushToTalk.subscribe, pushToTalk.getSnapshot);
  // Slid away: nothing was meant by it, so leave. The panel's own unmount gives
  // the microphone back and drops the audio with it, which is exactly what a
  // cancel wants. Not routed through `dismiss`: a cancel can only reach a
  // listening screen with nothing on it, so there is no batch to fold back to —
  // only the flag that makes the mic's parting `onDone` be ignored, and the way
  // out.
  // A spoken balance question was answered on the phone, for the answered event.
  useEffect(() => {
    if (phase === 'answer')
      trackAssistant('assistant_question_answered', { kind: 'balance', path: 'device' });
  }, [phase]);
  const cancelledHold = hold.ended?.mode === 'cancel' ? hold.ended.seq : 0;
  useEffect(() => {
    if (cancelledHold === 0) return;
    captureActive.current = false;
    router.back();
    pushToTalk.take({ seq: cancelledHold, mode: 'cancel' });
  }, [cancelledHold]);

  // Write the heard expenses into the capture inbox — the app's draft holding
  // area. Each draft's own id is the capture id, so a retry (or the leave-guard
  // firing after a Save that half-finished) re-uses it rather than minting a
  // duplicate. Shared by the "Save as draft" button and the close-intercept, so
  // the two land the same rows.
  const persistDraftsToInbox = useCallback(async (): Promise<void> => {
    const date = voiceExpenseDate ?? today();
    const fallback = t.voice.anExpense;
    // Several expenses spoken in one breath stay one thing in the inbox: they
    // share a batch id (carried in the capture's `parsed`, so no schema change),
    // and the inbox folds them into one collapsible total. A lone capture gets
    // none — there is nothing to group.
    const batchId = drafts.length > 1 ? randomUUID() : null;
    for (const draft of drafts) {
      const currency = draft.currency ?? dc;
      const amount = toMinor(draft.amount, currency);
      if (amount === null) continue;
      // Give the draft a guessed category from its description, the same read the
      // typed capture and add-expense forms do — so a voiced expense lands with a
      // sensible bucket rather than uncategorised. Null (unrecognised text) is fine.
      const description = draft.note.trim() || fallback;
      await createCapture.mutateAsync({
        captureId: draft.key,
        description,
        category: draft.category ?? guessCategory(description),
        expenseDate: date,
        currency,
        amount,
        location,
        parsed: batchId ? { voiceBatchId: batchId } : undefined,
      });
    }
  }, [drafts, dc, location, voiceExpenseDate, t.voice.anExpense, createCapture]);

  // Leaving the review with a draft batch and no group chosen must not throw the
  // expenses away — an unassigned batch is a draft, and a draft survives a close
  // (the user's rule). So intercept every way off the screen (the ✕, the OS back
  // gesture, the hardware back key) and file the batch in the inbox first. A
  // group destination is left to the explicit Save; closing it discards, as
  // before. `committed` stands the guard down once a Save is already navigating.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (event) => {
      if (committed.current) return;
      // Backing out of an "add more" sub-capture — the OS back gesture or
      // hardware key, not only the ✕ — returns to the review with the
      // batch intact, whether the mic is still listening or its interpretation is
      // pending ('thinking'). A late interpretation is cancelled with the token.
      if ((phase === 'listening' || phase === 'thinking') && drafts.length > 0) {
        event.preventDefault();
        captureActive.current = false;
        interpretToken.current += 1;
        setNoAmount(false);
        setMicMode('replace');
        setPhase('review');
        return;
      }
      if (phase !== 'review' || dest.kind !== 'unassigned') return;
      if (drafts.length === 0) return;
      // A draft is only kept if the whole batch is savable. Persisting only the
      // valid rows would silently drop the rest; leaving with an all-invalid
      // batch would lose it entirely. So if any row lacks a real amount, hold
      // the reader on the review with the batch intact and say why — they fix
      // the amount or remove the row (dropping to an empty batch, which leaves
      // freely). This mirrors the Save button, which is disabled on the same
      // condition.
      const allSavable = drafts.every(
        (draft) => toMinor(draft.amount, draft.currency ?? dc) !== null,
      );
      if (!allSavable) {
        event.preventDefault();
        setError(t.voice.draftNeedsAmounts);
        return;
      }
      event.preventDefault();
      committed.current = true;
      void (async () => {
        try {
          await persistDraftsToInbox();
          navigation.dispatch(event.data.action);
        } catch (caught) {
          // Keep the reader on the review with their batch intact rather than
          // navigating away having lost it.
          committed.current = false;
          setError(friendlyError(caught, t.couldNotSave, 'voice.persistDraft'));
        }
      })();
    });
    return unsub;
  }, [
    navigation,
    phase,
    dest,
    drafts,
    dc,
    persistDraftsToInbox,
    t.couldNotSave,
    t.voice.draftNeedsAmounts,
  ]);

  // On opening the review, read the current location once and pin the batch to
  // it — so the place is saved by default, no tap needed. It asks permission
  // just-in-time; a refusal or an unavailable fix leaves the field on its manual
  // "Add location" / "Pick on map" buttons rather than failing loudly. Never
  // overrides a pin the reader has since set or cleared: the latch runs it
  // exactly once per parsed batch.
  //
  // `captureLocation` only ever waits on a fast coordinate fix (lib/location's
  // `FAST_FIX_TIMEOUT_MS`) — never on reverse-geocoding, which can hang far
  // longer offline. The read is silent — no busy state of its own competes with
  // Save — and Save is never held up by the map/place-name lookup. The human-readable name, when there is
  // one, is resolved separately below and folds in only if it beats the
  // reader to Save; arriving after is fine to drop.
  useEffect(() => {
    if (phase !== 'review' || autoLocated.current) return;
    autoLocated.current = true;
    if (!locationAvailable()) return;
    const gen = locationGen.current;
    void (async () => {
      const result = await captureLocation();
      if (!result.ok) return;
      // Drop a fix that lost its race: the reader has since set or cleared the
      // pin by hand, or a fresh utterance moved on to a new batch.
      if (locationGen.current !== gen || locationTouched.current) return;
      const { lat, lng } = result.location;
      setLocation(result.location);
      // Best-effort, and never awaited: a name that lands after the pin was
      // touched, the batch moved on, or the expense was already saved is
      // simply dropped — coordinates alone are a saveable location.
      void reverseGeocode(lat, lng).then((name) => {
        if (!name) return;
        if (locationGen.current !== gen || locationTouched.current) return;
        setLocation((current) =>
          locationUnchanged(current, lat, lng) ? { ...current, name } : current,
        );
      });
    })();
  }, [phase]);

  /**
   * Say the save worked, once, wherever it leaves the reader.
   *
   * Every write below used to end by replacing this screen with its
   * destination, and for a group that is right: the ledger the expense has just
   * joined is the receipt, and the split is the thing worth a glance. "Just me"
   * is the one destination where it was not — a private tab, nothing to check,
   * and a save that dropped somebody into it left them navigating back out of a
   * screen they never asked for. That one returns to the dashboard, and the
   * confirmation carries what the screen would have said. The capture inbox
   * keeps its landing for the opposite reason to the group's: what was filed
   * there is unfinished and still wants assigning, so showing the queue is the
   * point. Every path says it worked, so the jump is never the only signal.
   */
  const confirmSaved = (): void => {
    reportCommand('confirmed', dest.kind === 'me' ? 'personal' : 'group');
    hapticSuccess();
  };

  // Who paid and who shares, once the destination group's members are known: the
  // spoken intent read against them, with the reader's corrections on top. Only
  // for an existing group — a new one has nobody to name yet.
  const targetMembers = useMemo(
    () => withAliases(toCandidates(target.members.data, viewerId), nameMemory, targetGroupId),
    [target.members.data, viewerId, nameMemory, targetGroupId],
  );
  const targetLearned = useMemo(
    () => learnedForGroup(nameMemory, targetGroupId),
    [nameMemory, targetGroupId],
  );
  const who: WhoView | null = (() => {
    // A plain "I paid, split equally" keeps the way it has always been written;
    // the card and the plan exist for sentences that said something more.
    if (!intent || dest.kind !== 'existing' || targetMembers.length === 0) return null;
    const destinationIntent =
      parseVoiceExpenses(intent.transcript, groupRefs, {
        members: targetMembers,
        currentGroupId: targetGroupId,
        learned: targetLearned,
        families: target.group.data?.units,
      }).intent ?? intent;
    if (!destinationIntent.hasSocialDetail && !whoForced) return null;
    const first = drafts[0];
    const firstCurrency = first
      ? voiceSaveCurrency(first.currency, target.group.data?.default_currency ?? dc, dc)
      : dc;
    return planWho(
      destinationIntent,
      targetMembers,
      whoEdit,
      first ? toMinor(first.amount, firstCurrency) : null,
      drafts.length,
      targetLearned,
      target.group.data?.units,
    );
  })();

  // The reader settled a heard name: "Did you mean Renny?" → yes, a tap on one
  // of "Ravi or Rajiv?", or a pick in the sheet. It counts for this review at
  // once and is remembered for this group, so the same words find the same
  // person next time.
  const rememberPick = (heard: string | undefined, memberId: string): void => {
    if (!heard || !targetGroupId) return;
    void rememberNamePick(viewerId, {
      heard,
      memberId,
      groupId: targetGroupId,
      members: targetMembers,
    });
  };
  const pickName = (party: VoiceParty, memberId: string): void => {
    const heard = party.heard ?? party.name;
    setWhoEdit((current) => ({
      ...current,
      picks: { ...current?.picks, [nameKey(heard)]: memberId },
    }));
    rememberPick(heard, memberId);
  };
  // A change made in the sheet is a correction of what was heard, when it is
  // clear which heard name it answers: the named payer, or the one person in
  // the split still in question.
  const editWho = (next: WhoEdit): void => {
    setWhoEdit((current) => ({ ...current, ...next }));
    if (!who) return;
    const { payer, participants } = who.intent;
    if (next.payerId && payer.kind === 'member' && payer.explicit)
      rememberPick(payer.heard, next.payerId);
    if (next.participantIds) {
      const added = next.participantIds.filter((id) => !who.participantIds.includes(id));
      const open = (participants ?? []).filter(
        (party) => party.kind === 'member' && party.status !== 'resolved',
      );
      const only = open[0];
      if (added.length === 1 && open.length === 1 && only && added[0])
        rememberPick(only.heard, added[0]);
    }
  };
  // Someone other than me paid: nowhere but a group can keep that.
  const payerElsewhere = intent?.payer.explicit === true && intent.payer.kind === 'member';
  const groupPending =
    intent !== null &&
    (intent.groupSource === 'ambiguous' || intent.groupSource === 'unresolved') &&
    !groupChosen;
  // The spoken amount's open questions, one at a time: the first row whose
  // amount could be read two ways, then any bare "dollars" still unanswered.
  const choiceStrings = {
    amountWhich: t.voice.amountWhich,
    amountTotalOrEach: t.voice.amountTotalOrEach,
    amountTotal: t.voice.amountTotal,
    amountEach: t.voice.amountEach,
    whichDollars: t.voice.whichDollars,
    dollarNames: { USD: t.voice.usDollars, AUD: t.voice.audDollars },
  };
  const sharePeople =
    who?.participantIds.length ??
    voiceSplitCount ??
    (dest.kind === 'existing' && targetMembers.length > 0
      ? targetMembers.length
      : dest.kind === 'people'
        ? dest.ghostNames.length + 1
        : null);
  const groupCurrencyNow = target.group.data?.default_currency ?? null;
  let amountQuestion: { draft: Draft; question: VoiceAmountQuestion } | null = null;
  for (const draft of drafts) {
    if (draft.amountAnswered || !draft.amountReading) continue;
    const shown = voiceSaveCurrency(draft.currency, groupCurrencyNow, dc);
    const question = voiceAmountQuestion(
      draft.amountReading,
      draft.currency,
      sharePeople,
      choiceStrings,
      (major) => formatMoney(money(decimalToMinor(major, shown) ?? 0n, shown), { locale }),
    );
    if (question) {
      amountQuestion = { draft, question };
      break;
    }
  }
  const currencyDraft = drafts.find(
    (draft) => !draft.currencyAnswered && voiceCurrencyQuestion(draft.amountReading, choiceStrings),
  );
  const currencyQuestion = currencyDraft
    ? voiceCurrencyQuestion(currencyDraft.amountReading, choiceStrings)
    : null;
  const answerAmount = (key: string): void => {
    if (!amountQuestion) return;
    const answer = amountQuestion.question.answers.find((candidate) => candidate.key === key);
    if (!answer) return;
    editDraft(amountQuestion.draft.key, {
      amountAnswered: true,
      ...(answer.amount !== undefined ? { amount: answer.amount } : null),
    });
  };
  const answerCurrency = (key: string): void => {
    const answer = currencyQuestion?.answers.find((candidate) => candidate.key === key);
    if (!answer?.currency) return;
    const chosen = answer.currency;
    // Every row still asking which dollars takes the answer.
    setDrafts((current) =>
      current.map((draft) =>
        !draft.currencyAnswered && voiceCurrencyQuestion(draft.amountReading, choiceStrings)
          ? { ...draft, currency: chosen, currencyAnswered: true }
          : draft,
      ),
    );
  };
  const amountPending = amountQuestion !== null || currencyQuestion !== null;
  const whoBlocked =
    amountPending ||
    groupPending ||
    (who !== null && who.problems.length > 0) ||
    (payerElsewhere && dest.kind !== 'existing');

  // A save finished: the leave-guard stands down and the success state shows.
  const landSaved = (
    result:
      | { kind: 'expense'; line: string; state: SavedState; write: AgentExpenseWrite | null }
      | { kind: 'line'; line: string },
  ): void => {
    committed.current = true;
    setEditingDraft(false);
    setSavedHandoff(null);
    setSavedResult(result);
    setPhase('saved');
  };

  const save = async (): Promise<void> => {
    await saveGate.run(saveOnce);
  };

  const saveOnce = async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      const date = voiceExpenseDate ?? today();
      const fallback = t.voice.anExpense;

      if (dest.kind === 'settle') {
        // A spoken settle-up. The other member is on the dest; my own member id
        // is read from the group now that it has loaded. `iPay` (I owe them)
        // sets the direction; the amount is the whole balance or a partial. Cash
        // is the neutral default rail — the reader can change it on the ledger.
        const members = target.members.data ?? [];
        const myMemberId = members.find((member) => isViewer(member, viewerId))?.id;
        if (!myMemberId) throw new Error('no member to settle as');
        // The floor under `tryMoneyIntent`: never record a rate-less debt.
        if (ratelessDebt(dest.groupId, dest.currency)) throw new Error('no rate yet');
        await recordSettlement.mutateAsync({
          groupId: dest.groupId,
          fromMemberId: dest.iPay ? myMemberId : dest.toMemberId,
          toMemberId: dest.iPay ? dest.toMemberId : myMemberId,
          amount: dest.amount,
          rail: 'cash',
          currency: dest.currency,
        });
        reportCommand('confirmed', 'group');
        hapticSuccess();
        landSaved({ kind: 'line', line: fill(t.voiceScreen.savedSettled, { name: dest.name }) });
        return;
      }

      if (dest.kind === 'remind') {
        // A nudge to settle. The server decides the amount, the wording, and
        // whether to send at all (only a real debt, once a day). A rate-limit is
        // a normal "already reminded today", not a failure — swallow just that.
        try {
          await nudgeToSettle({
            groupId: dest.groupId,
            toMemberId: dest.toMemberId,
            currency: dest.currency,
          });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : '';
          if (!/NUDGE_RATE_LIMIT/i.test(message)) throw caught;
        }
        reportCommand('confirmed', 'group');
        hapticSuccess();
        landSaved({ kind: 'line', line: fill(t.voiceScreen.savedReminded, { name: dest.name }) });
        return;
      }

      if (dest.kind === 'add-member') {
        // Add a ghost per spoken name. Names already in the group are skipped —
        // so a retry after a partial failure, or re-speaking the command, adds no
        // duplicate (there is no member id to reuse the way a `people` batch has).
        const existing = new Set(
          (target.members.data ?? []).map((member) =>
            displayName(member, viewerId).trim().toLowerCase(),
          ),
        );
        for (const name of dest.names) {
          if (existing.has(name.trim().toLowerCase())) continue;
          await addGhost.mutateAsync(name);
        }
        reportCommand('confirmed', 'group');
        hapticSuccess();
        landSaved({
          kind: 'line',
          line: fill(t.voiceScreen.savedMembers, {
            name: dest.names.join(', '),
            group: dest.groupName,
          }),
        });
        return;
      }

      if (dest.kind === 'unassigned') {
        // No group chosen: keep the batch as a draft in the capture inbox.
        await persistDraftsToInbox();
        confirmSaved();
        // Kept as a draft in the inbox; said here, and the reader stays put.
        landSaved({ kind: 'line', line: t.voiceScreen.savedForLater });
        return;
      }

      if (dest.kind === 'me') {
        // Just me: each draft is a private personal expense (A48), in its own
        // spoken currency. The draft's stable id is the record id, so a retry
        // after a partial failure re-uses it rather than writing a duplicate.
        let single: SavedState | null = null;
        for (const draft of drafts) {
          const currency = draft.currency ?? dc;
          const amount = toMinor(draft.amount, currency);
          if (amount === null) continue;
          const description = draft.note.trim() || fallback;
          await upsertPersonal.mutateAsync({
            recordId: draft.key,
            recordKind: 'txn',
            data: encodeTxn({
              kind: 'expense',
              amount,
              currency,
              category: draft.category ?? guessCategory(description),
              note: description,
              date,
              loanId: null,
              recurringId: null,
            }),
          });
          if (drafts.length === 1)
            single = {
              kind: 'personal',
              id: draft.key,
              groupId: null,
              description,
              amount,
              currency,
              category: draft.category ?? guessCategory(description),
              categoryStated: draft.category !== null,
              date,
              notes: null,
              place: location?.name ?? null,
              location,
              paymentMethod: null,
              payers: null,
              hasReceipt: false,
              reimbursable: false,
              participants: [],
            };
        }
        confirmSaved();
        const line = fill(t.voiceScreen.savedTo, { where: t.voiceScreen.justYou });
        landSaved(
          single
            ? { kind: 'expense', line, state: single, write: null }
            : { kind: 'line', line: plural(locale, drafts.length, t.voice.savedCount) },
        );
        return;
      }

      // A group destination. Make the group first if it is a new one — its id
      // and the reader's member id were chosen up front, so an expense can name
      // them in the same breath (the offline-first pattern used elsewhere). The
      // ref guards a second create on a retry: the group exists after the first.
      if ((dest.kind === 'create' || dest.kind === 'people') && !groupCreated.current) {
        const currency = voiceNewGroupCurrency(
          drafts.map((draft) => draft.currency),
          dc,
        );
        await createGroup.mutateAsync({
          groupId: dest.groupId,
          creatorMemberId: dest.memberId,
          name: dest.name,
          type: GroupType.Other,
          currency,
        });
        groupCreated.current = true;
        setCreatedGroupCurrency(currency);
      }

      // The brand-new people each need a ghost in the group — minted once (one
      // per name, in order) and reused on a retry, so a partial failure adds no
      // second set. A lone name is the 1:1 case; several is a real group.
      if (dest.kind === 'people' && !ghostMemberIds.current) {
        const ids: string[] = [];
        for (const ghostName of dest.ghostNames) {
          ids.push(await addGhost.mutateAsync(ghostName));
        }
        ghostMemberIds.current = ids;
      }

      const groupCurrency =
        dest.kind === 'existing'
          ? (target.group.data?.default_currency ?? dc)
          : // Once made, the group's currency is what it was made in: a retry
            // after the drafts were edited must not pick a different one.
            (createdGroupCurrency ??
            voiceNewGroupCurrency(
              drafts.map((draft) => draft.currency),
              dc,
            ));
      const groupMembers = target.members.data ?? [];
      // A named payer or people are never defaulted: Save is held until every one
      // is matched to a member (see `whoBlocked`), so this only ever runs with a plan.
      if (who && who.problems.length > 0) throw new Error('payer or people not resolved');
      const payer =
        dest.kind === 'existing'
          ? (who?.payerId ??
            groupMembers.find((member) => isViewer(member, viewerId))?.id ??
            groupMembers[0]?.id)
          : dest.memberId;
      if (!payer) throw new Error('no members to split among');
      const splitParams: SplitParams = dest.kind === 'existing' && who ? who.params : EQUAL;
      const participants: readonly string[] =
        dest.kind === 'existing' && who
          ? who.participantIds
          : dest.kind === 'existing'
            ? resolveVoiceParticipants({
                all: groupMembers.map((member) => member.id),
                payer,
                members: groupMembers.map((member) => ({
                  id: member.id,
                  name: displayName(member, viewerId),
                })),
                peopleText: voicePeopleText,
                splitCount: voiceSplitCount,
              })
            : dest.kind === 'people'
              ? [dest.memberId, ...(ghostMemberIds.current ?? [])]
              : [dest.memberId];

      if (participants.length === 0) throw new Error('no members to split among');

      let single: { state: SavedState; write: AgentExpenseWrite } | null = null;
      for (const draft of drafts) {
        // The currency that was said, not the group's: "200 dollars" is $200 in
        // a rupee group, never ₹200. Only an unheard currency takes the group's.
        const currency = voiceSaveCurrency(draft.currency, groupCurrency, dc);
        const amount = toMinor(draft.amount, currency);
        if (amount === null) continue;
        // Unless the sentence said otherwise, a spoken expense is "I paid, split
        // it equally" — everyone in, me as payer; when it named a payer, people
        // or a split, those are what is written (and what the review showed).
        // The reader can refine any of it on the expense afterwards.
        // The draft's stable id is the expense id (and the split seed), so a
        // retry appends no duplicate.
        const expenseId = draft.key;
        const shares = computeShares({
          amount,
          currency,
          params: splitParams,
          participants,
          seed: expenseId,
        });
        // Same category guess as the inbox path: a voiced expense carries a bucket
        // read from its description, which the reader can still change afterwards.
        const description = draft.note.trim() || fallback;
        const write: AgentExpenseWrite = {
          expenseId,
          description,
          category: draft.category ?? guessCategory(description),
          expenseDate: date,
          currency,
          amount,
          splitParams,
          participants: [...participants],
          payers: { [payer]: amount },
          // ShareMap is a Map; the write input wants a plain record.
          expectedShares: Object.fromEntries(shares),
        };
        await writeExpense.mutateAsync({ ...write, location });
        if (drafts.length === 1)
          single = {
            write,
            state: {
              kind: 'group',
              id: expenseId,
              groupId: dest.groupId,
              description,
              amount,
              currency,
              category: write.category,
              categoryStated: draft.category !== null,
              date,
              notes: null,
              place: location?.name ?? null,
              location,
              paymentMethod: null,
              payers: write.payers,
              hasReceipt: false,
              reimbursable: false,
              participants: write.participants,
            },
          };
      }
      confirmSaved();
      // Stay here: the group's ledger is one tap away from the success state,
      // never a jump the reader did not ask for.
      const line = fill(t.voiceScreen.savedTo, { where: current.label });
      landSaved(
        single
          ? { kind: 'expense', line, ...single }
          : { kind: 'line', line: plural(locale, drafts.length, t.voice.savedCount) },
      );
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'voice.save'));
    } finally {
      setSaving(false);
    }
  };

  // The auto-commit timer fires whatever `save` is current when the window ends,
  // so the write reads the destination and drafts as they finally stand. Kept in
  // a ref via an effect (not a render-time assignment) so it tracks each render.
  useEffect(() => {
    commitRef.current = save;
  });

  // A pending auto-commit must not outlive the screen: clear it on unmount so a
  // timer never fires save() after the component is gone.
  useEffect(
    () => () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    },
    [],
  );

  // Every draft must carry a real amount — an empty or non-numeric field would
  // otherwise be silently skipped, and a screenful of them would "save" nothing
  // while still navigating away.
  // From the widget, the save is not waited on by anyone: it goes by itself,
  // and never waits on the location fix — `save` writes whatever `location` has
  // resolved to by that moment (coordinates, or none at all).
  const linkReady =
    drafts.length > 0 &&
    !saving &&
    !whoBlocked &&
    drafts.every((draft) => toMinor(draft.amount, draft.currency ?? dc) !== null);
  // Only into the inbox. Anything can open a `waves://voice?heard=` link, so
  // what a link may write unattended is a draft only the reader sees ("Saved
  // for later"); a group, a person or a command still waits for their tap.
  const autoSaved = useRef(false);
  useEffect(() => {
    if (!heardFromLink.current || autoSaved.current) return;
    if (phase !== 'review' || !linkReady || dest.kind !== 'unassigned') return;
    autoSaved.current = true;
    void Promise.resolve().then(() => save());
    // `save` is a fresh closure each render; this fires once per widget capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, linkReady, dest.kind]);

  // Save is never held up by location: it is not in this list. `save` picks up
  // whatever `location` holds the moment it runs — coordinates if the fast fix
  // landed in time, nothing otherwise — rather than waiting on it.
  const canSave =
    drafts.length > 0 &&
    !saving &&
    !whoBlocked &&
    drafts.every((draft) => toMinor(draft.amount, draft.currency ?? dc) !== null);

  // Every destination keeps each draft's spoken currency (see `save`); a draft
  // with none takes the group's currency for a group, else the reader's default.
  const destCurrency =
    dest.kind === 'unassigned' || dest.kind === 'me'
      ? null
      : dest.kind === 'existing'
        ? (target.group.data?.default_currency ?? dc)
        : (createdGroupCurrency ??
          voiceNewGroupCurrency(
            drafts.map((draft) => draft.currency),
            dc,
          ));

  const current = describeDest(dest, groupRows, t, viewer.name, labelOf);

  // The destination as the picker reads it. The picker only needs to know which
  // row carries the check, so the kinds it has no row for — a spoken settle-up,
  // a nudge, "add Ravi to the trip" — read as nothing selected. (It is never
  // opened over one of those; the answer card is.)
  const pickerSelection: DestinationSelection =
    dest.kind === 'unassigned' ||
    dest.kind === 'me' ||
    dest.kind === 'create' ||
    dest.kind === 'existing'
      ? dest.kind === 'existing'
        ? { kind: 'existing', groupId: dest.groupId }
        : { kind: dest.kind }
      : dest.kind === 'people'
        ? { kind: 'people', names: dest.ghostNames }
        : { kind: 'none' };

  // With no group chosen the batch is a draft (it lands in the capture inbox),
  // so the button says so; once a group is picked it writes real expenses and
  // the label counts them.
  const isDraft = dest.kind === 'unassigned';
  const saveLabel = isDraft
    ? t.voice.saveDraft
    : drafts.length === 1
      ? t.voiceScreen.addExpense
      : plural(locale, drafts.length, t.voice.save);

  // The review's state, read from the screen's own phase and flags.
  // The stage that stays on screen once the sentence is heard (mic, status,
  // transcript) reads the same flow, whichever card is under it.
  const stageInput = {
    phase,
    saving,
    needsAnswer: whoBlocked,
    agent: agentStage,
    answering:
      (answer?.kind === 'group' && queryLedger.loading) || (answer?.kind === 'owed' && owedLoading),
  };
  const stageState = voiceFlowState(stageInput);
  const stageTap = stageMicTap(phase, stageState);
  // Tapping the mic speaks the next sentence in place: onto the reviewed batch,
  // or fresh after a card or an answer.
  const onStageMic = (): void => {
    hapticSelect();
    if (stageTap === 'append') startAddMore();
    else if (stageTap === 'fresh') {
      if (phase === 'answer') askAgain();
      else addAnother();
    }
  };
  // The first expense, which the split is set against (one total cannot be spread
  // over several, so more than one keeps to an equal split).
  const firstDraft = drafts[0];
  const splitCurrency = voiceSaveCurrency(firstDraft?.currency ?? null, destCurrency, dc);
  const splitAmount = firstDraft ? toMinor(firstDraft.amount, splitCurrency) : null;
  // Who shares it, their payer and split can be set in the sheet when the
  // destination is one of the reader's groups.
  const canEditSplit =
    dest.kind === 'existing' && targetMembers.length > 0 && intent !== null && splitAmount !== null;
  const openSplit = (view: 'people' | 'payer'): void => {
    setWhoForced(true);
    setSplitView(view);
    setSplitOpen(true);
  };

  // Names in the split, "You" first; null when no split applies yet.
  const splitWith: string[] | null = (() => {
    if (dest.kind === 'me') return [t.voiceScreen.justYou];
    if (dest.kind === 'create') return [t.voice.youLabel];
    if (dest.kind === 'people') return [t.voice.youLabel, ...dest.ghostNames];
    const members = target.members.data ?? [];
    if (dest.kind !== 'existing' || members.length === 0) return null;
    const nameOf = (id: string): string => {
      const member = members.find((candidate) => candidate.id === id);
      if (!member) return '';
      return isViewer(member, viewerId) ? t.voice.youLabel : displayName(member, viewerId);
    };
    const ids = who
      ? who.participantIds
      : resolveVoiceParticipants({
          all: members.map((member) => member.id),
          payer: members.find((member) => isViewer(member, viewerId))?.id ?? members[0]?.id ?? '',
          members: members.map((member) => ({
            id: member.id,
            name: displayName(member, viewerId),
          })),
          peopleText: voicePeopleText,
          splitCount: voiceSplitCount,
        });
    const names = ids.map(nameOf).filter(Boolean);
    return [
      ...names.filter((name) => name === t.voice.youLabel),
      ...names.filter((name) => name !== t.voice.youLabel),
    ];
  })();
  // One plain line: "Split equally with: You, Ravi", or the split in words when
  // it was set another way. Who paid is a second small line only when it was not you.
  const splitText =
    (who ? describeSplit(who, targetMembers, splitCurrency, t) : null) ??
    (splitWith && splitWith.length > 1
      ? t.voiceScreen.splitEquallyWith.replace('{names}', splitWith.join(', '))
      : null);
  const payerMember = who?.payerId ? targetMembers.find((m) => m.id === who.payerId) : undefined;
  const splitProps = splitText
    ? {
        text: splitText,
        paidBy:
          payerMember && !payerMember.isMe
            ? t.voiceScreen.paidByName.replace('{name}', payerMember.name)
            : null,
        onPress: canEditSplit ? () => openSplit('people') : undefined,
        onPaidBy: canEditSplit ? () => openSplit('payer') : undefined,
      }
    : null;

  // The single heard expense as a structured preview, from the parser's real
  // output. Several expenses keep the list.
  const preview: ExpensePreview | null = (() => {
    if (!firstDraft || drafts.length !== 1) return null;
    const description = firstDraft.note.trim() || t.voice.anExpense;
    return {
      description,
      amountMinor: toMinor(firstDraft.amount, splitCurrency),
      amountText: firstDraft.amount.trim(),
      currency: splitCurrency,
      category: firstDraft.category ?? guessCategory(description),
    };
  })();
  const categoryLabel = preview?.category
    ? (categoryCatalog.find((entry) => entry.key === preview.category)?.label ??
      (t.categories as Record<string, string>)[preview.category] ??
      null)
    : null;

  // The review asks one thing at a time: the first of these that is open is the
  // only part of the review on screen until it is answered.
  const partyText = {
    you: t.voice.youLabel,
    didYouMean: t.voice.didYouMean,
    didYouMeanYes: t.voice.didYouMeanYes,
    whichOf: t.voice.whichOf,
  };
  const askedParty = (who?.intent.participants ?? [])
    .map((party) => ({ party, ask: partyQuestion(party, targetMembers, partyText) }))
    .find((entry) => entry.ask !== null);
  const payerParty =
    who && who.problems.some((problem) => problem.code === 'payer_unresolved')
      ? who.intent.payer
      : null;
  const groupOpen = groupPending || (payerElsewhere && dest.kind !== 'existing');
  const reviewOpen: ReviewOpen = {
    amount: amountQuestion !== null,
    currency: currencyQuestion !== null,
    group: groupOpen,
    payer: payerParty !== null,
    people:
      askedParty !== undefined ||
      who?.problems.some((problem) => problem.code !== 'payer_unresolved') === true,
  };
  const question = currentQuestion(reviewOpen);

  // The line the answer card shows. A `text` answer is ready; a `group` one is
  // composed from its ledger and shows a spinner until the balance has loaded.
  const answerLine = (): { text: string } | { loading: true } => {
    if (!answer) return { text: '' };
    if (answer.kind === 'text') return { text: answer.text };
    if (answer.kind === 'spend' || answer.kind === 'owed') return { text: '' };
    if (queryLedger.loading) return { loading: true };
    const balance = queryLedger.myBalance;
    const amount = (minor: bigint): string =>
      `${Number(minor) / Number(minorUnitScale(answer.currency))} ${answer.currency}`;
    if (balance === 0n)
      return { text: t.voice.ansGroupSettled.replace('{group}', answer.groupName) };
    if (balance > 0n)
      return {
        text: t.voice.ansGroupOwed
          .replace('{group}', answer.groupName)
          .replace('{amount}', amount(balance)),
      };
    return {
      text: t.voice.ansGroupOwe
        .replace('{group}', answer.groupName)
        .replace('{amount}', amount(-balance)),
    };
  };

  // Ask another question: clear the answer and reopen the mic.
  // Done: back to wherever the reader came from. Never into a group.
  const finishVoice = (): void => {
    router.back();
  };

  // Add another: the same screen, fresh, listening again.
  const addAnother = (): void => {
    committed.current = false;
    autoSaved.current = false;
    heardFromLink.current = false;
    captureActive.current = false;
    groupCreated.current = false;
    ghostMemberIds.current = null;
    interpretToken.current += 1;
    setSavedResult(null);
    setSavedHandoff(null);
    setDrafts([]);
    setIntent(null);
    setWhoEdit(null);
    setWhoForced(false);
    setRequested(null);
    setDest({ kind: 'unassigned' });
    setGroupChosen(false);
    setVoicePeopleText(null);
    setVoiceSplitCount(null);
    setVoiceExpenseDate(null);
    setLocation(null);
    setHeardText('');
    setEditingDraft(false);
    setDetailsOpen(true);
    setError(null);
    setAnswer(null);
    setAgentSession(null);
    setAgentFollowUp(null);
    setNoAmount(false);
    setTypedMode(false);
    setMicMode('replace');
    setAttempt((current) => current + 1);
    setPhase('listening');
  };

  const askAgain = (): void => {
    setAgentSession(null);
    setAgentFollowUp(null);
    setPanelFooter(null);
    setAnswer(null);
    setQueryGroupId('');
    setMicMode('replace');
    setNoAmount(false);
    setAttempt((current) => current + 1);
    setPhase('listening');
  };

  // "Edit text" on what was heard: the words go into the typed composer, to be
  // corrected and sent again through the same pipeline. Leaving the composer
  // with ✕ while a batch exists returns to that batch (see `dismiss`).
  const editHeard = (): void => {
    captureActive.current = false;
    interpretToken.current += 1;
    setTypedDraft(heardText);
    setTypedMode(true);
    setNoAmount(false);
    setMicMode('replace');
    setPhase('listening');
  };

  // A suggestion row. A question goes straight through the assistant (it
  // answers it); an expense sentence is put in the composer to check and send,
  // never saved on a tap.
  const pickSuggestion = (suggestion: Suggestion): void => {
    hapticSelect();
    const words = suggestionWords(suggestion.text);
    if (suggestion.kind === 'question') {
      submitTyped(words);
      return;
    }
    captureActive.current = false;
    setTypedDraft(words);
    setTypedMode(true);
  };
  // Balance questions can be answered locally without the agent.
  const canPickSuggestion = (suggestion: Suggestion): boolean =>
    suggestion.kind === 'expense' ||
    agentOn ||
    Boolean(detectBalanceQuery(suggestionWords(suggestion.text)));

  const pickAnswerFollowUp = (followUp: AnswerFollowUp): void => {
    hapticSelect();
    if (followUp === 'settle' || followUp === 'expense') {
      router.dismissTo(followUp === 'settle' ? '/settle-up' : '/capture');
      return;
    }
    setAgentSession(null);
    setAgentFollowUp(null);
    setAnswer(null);
    setQueryGroupId('');
    submitTyped(followUp === 'owe' ? 'Who do I owe?' : 'Who owes me?');
  };

  const renderAnswerFollowUps = (value: Parameters<typeof answerFollowUps>[0]) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
      {answerFollowUps(value).map((followUp) => (
        <Chip
          key={followUp}
          label={
            followUp === 'owed'
              ? t.voiceScreen.askWhoOwes
              : followUp === 'owe'
                ? t.voiceScreen.askWhoIOwe
                : followUp === 'settle'
                  ? t.homeDash.settleUp
                  : t.voiceScreen.addExpense
          }
          onPress={() => pickAnswerFollowUp(followUp)}
        />
      ))}
    </View>
  );

  // Typed text enters the same pipeline as a spoken sentence: the mic is let go,
  // the text is treated as a live capture, and the screen decides who reads it.
  const submitTyped = (text: string): void => {
    lastTyped.current = text;
    setTypedDraft('');
    captureActive.current = true;
    heardFromLink.current = false;
    setAgentQuotaNote(false);
    setNoAmount(false);
    setMicMode('replace');
    handleTranscript(text, { typed: true });
  };

  // A Free person's saved expense: the same summary card, with no Undo and no
  // question after it. Done is below it.
  const renderFreeAfterSave = (saved: SavedState): ReactNode => {
    const where =
      saved.kind === 'personal'
        ? t.followUps.wherePersonal
        : (groupRows.find((group) => group.id === saved.groupId)?.name?.trim() ??
          t.followUps.wherePersonal);
    const category = saved.category
      ? ((t.categories as Record<string, string>)[saved.category] ?? '')
      : '';
    return (
      <SavedSummary
        amount={formatMoney(money(saved.amount, saved.currency), { locale })}
        detail={[category, where].filter(Boolean).join(' · ')}
      />
    );
  };

  const choosePeople = canEditSplit
    ? { label: t.voiceScreen.splitWith, onPress: () => openSplit('people') }
    : undefined;
  // The one open question as a card: tap an answer and it is applied.
  const renderQuestion = (): ReactNode => {
    if (question === 'amount' && amountQuestion)
      return (
        <ReviewQuestionCard
          title={amountQuestion.question.prompt}
          options={amountQuestion.question.answers}
          onSelect={answerAmount}
        />
      );
    if (question === 'currency' && currencyQuestion)
      return (
        <ReviewQuestionCard
          title={currencyQuestion.prompt}
          options={currencyQuestion.answers}
          onSelect={answerCurrency}
        />
      );
    if (question === 'group' && intent) {
      const ambiguous = groupPending && intent.groupSource === 'ambiguous';
      return (
        <ReviewQuestionCard
          title={
            !groupPending
              ? t.voice.needGroupForPayer.replace('{name}', intent.payer.name)
              : ambiguous
                ? t.voice.whichGroup
                : t.voice.noGroupNamed.replace('{name}', intent.groupHint?.name ?? '')
          }
          options={
            ambiguous
              ? (intent.groupHint?.candidates ?? []).map((candidate) => ({
                  key: candidate.id,
                  label: candidate.name ?? '',
                }))
              : []
          }
          onSelect={chooseGroup}
          action={{ label: t.voice.chooseGroup, onPress: () => setPickerOpen(true) }}
        />
      );
    }
    if (question === 'payer' && payerParty) {
      const ask = partyQuestion(payerParty, targetMembers, partyText);
      return (
        <ReviewQuestionCard
          title={ask?.title ?? `${t.voice.whoPaid} “${payerParty.name}”`}
          options={
            ask
              ? ask.options.map((option) => ({ key: option.memberId, label: option.label }))
              : targetMembers.map((member) => ({
                  key: member.id,
                  label: member.isMe ? t.voice.youLabel : member.name,
                }))
          }
          onSelect={(memberId) =>
            ask ? pickName(payerParty, memberId) : editWho({ payerId: memberId })
          }
        />
      );
    }
    if (question === 'people' && who) {
      const unknown = who.problems.find((problem) => problem.code === 'participant_unresolved');
      return (
        <ReviewQuestionCard
          title={
            askedParty?.ask
              ? askedParty.ask.title
              : unknown && unknown.code === 'participant_unresolved'
                ? t.voice.whoUnknown.replace('{name}', unknown.name)
                : t.voice.splitInvalid
          }
          options={
            askedParty?.ask
              ? askedParty.ask.options.map((option) => ({
                  key: option.memberId,
                  label: option.label,
                }))
              : []
          }
          onSelect={(memberId) => askedParty && pickName(askedParty.party, memberId)}
          action={choosePeople}
        />
      );
    }
    return null;
  };

  // The one action area at the foot. It holds the same slots in every step; only
  // what sits in them changes.
  const footerSpec: FooterSpec =
    phase === 'answer'
      ? { primary: { label: t.voiceScreen.askSomethingElse, onPress: askAgain } }
      : phase === 'review'
        ? {
            primary: {
              label: saving ? t.voiceScreen.statusSaving : saveLabel,
              disabled: !canSave,
              onPress: () => void save(),
            },
          }
        : phase === 'saved'
          ? {
              primary: { label: t.voiceScreen.done, onPress: finishVoice },
              secondary: { label: t.voiceScreen.addAnother, onPress: addAnother },
            }
          : phase === 'committing' && autoBanner?.needsConfirm
            ? {
                primary: {
                  label: t.voice.autoConfirm,
                  onPress: () => runAutoCommit(autoBanner.fallback),
                },
              }
            : phase === 'agent'
              ? (panelFooter ?? {})
              : {};

  // The stage (headline, mic, status, wave) is the same in every phase until a
  // card is answering: while listening the mic panel reports its state up,
  // otherwise it is read from the screen's own flow. Only what is under it changes.
  const listeningLive = phase === 'listening' && !typedMode;
  const topStage = listeningLive ? capStage : null;
  const topStatus: VoiceStatusKey = listeningLive
    ? (capStage?.status ?? 'ready')
    : phase === 'listening'
      ? 'ready'
      : stageStatusKey(stageInput);
  const basicQuestion = noAmount && isVoiceAssistantRequest(heardText);
  const topMicMode: StageMicMode = listeningLive
    ? (capStage?.micMode ?? 'start')
    : phase === 'listening'
      ? 'start'
      : stageMicMode(stageState);
  const onTopMic = (): void => {
    if (listeningLive) topStage?.onMicPress();
    else if (phase === 'listening') {
      // Typing: the mic is the way back to speaking.
      setNoAmount(false);
      setAttempt((current) => current + 1);
      setTypedMode(false);
    } else onStageMic();
  };
  // A card is answering (a question, the review, the agent's proposal, an answer,
  // the saved summary): the headline, mic, status and wave give way and the
  // heard words sit right under the header, with the card after them.
  const stageSettled =
    phase === 'review' ||
    phase === 'saved' ||
    phase === 'answer' ||
    (phase === 'agent' && agentStage !== 'working');
  // A short phone trims the stage's gaps instead of scrolling it.
  const { height: windowHeight } = useWindowDimensions();
  const compactTop = windowHeight < 720;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      {/* The shared lavender backdrop and waves; everything else
          scrolls over it. */}
      <VoiceScene />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          // Scrolls only when the content is taller than the screen.
          scrollEnabled={contentHeight > viewportHeight + 1}
          bounces={false}
          overScrollMode="never"
          onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
          onContentSizeChange={(_width, height) => setContentHeight(height)}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: insets.top + theme.spacing.sm,
            paddingBottom: theme.spacing.lg,
            gap: theme.spacing.md,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Just the ✕ (and typing, while listening). Speaking another expense is
              one job with one home — the mic — so there is no second mic here. */}
          <VoiceHeader>
            {phase === 'listening' && !typedMode ? (
              <IconButton
                label={t.assistant.composerTypeInstead}
                onPress={() => {
                  hapticSelect();
                  captureActive.current = false;
                  setTypedMode(true);
                }}
              >
                <Ionicons name="keypad-outline" size={iconSize.lg} color={theme.color.text} />
              </IconButton>
            ) : null}
            <IconButton label={t.common.close} onPress={dismiss}>
              <Ionicons name="close" size={iconSize.xl} color={theme.color.text} />
            </IconButton>
          </VoiceHeader>
          {!stageSettled ? (
            <VoiceTop
              status={topStatus}
              statusMessage={basicQuestion ? t.voiceScreen.statusQuestion : undefined}
              micMode={topMicMode}
              onMicPress={onTopMic}
              reduceMotion={reduceMotion}
              level={listeningLive ? (capStage?.level ?? null) : null}
              compact={compactTop}
            />
          ) : null}
          <RewardedAdEntry kind="voice" />
          {basicQuestion ? (
            <Link href="/paywall" asChild>
              <Text tone="brand" accessibilityRole="link" style={{ textAlign: 'center' }}>
                {t.rewardedAds.upgrade}
              </Text>
            </Link>
          ) : null}
          {error ? <Callout tone="negative">{error}</Callout> : null}
          {agentQuotaNote && phase !== 'agent' ? (
            <Text variant="caption" tone="muted">
              {t.voice.agentQuotaFallback}
            </Text>
          ) : null}
          {/* What was heard heads the sheet in every step after the sentence; the
              cards below it change in place. The listening phase draws the same
              transcript inside the mic panel. */}
          {phase !== 'listening' ? (
            <VoiceSheetBody
              transcript={heardText}
              final
              onEditTranscript={
                phase === 'review' || phase === 'agent' || phase === 'saved' ? editHeard : undefined
              }
            />
          ) : null}

          {phase === 'agent' && agentSession ? (
            <VoiceAgentPanel
              key={agentRun}
              transcript={agentSession.transcript}
              groupId={launchGroupId}
              personal={launchPersonal}
              today={today()}
              onFallback={agentFellBack}
              followUp={agentFollowUp}
              renderAfterSave={isPro ? undefined : renderFreeAfterSave}
              onSavedBarEvent={(event) => {
                if (event.name === 'assistant_correction') {
                  trackAssistant('assistant_correction', {
                    field: event.field,
                    path: event.path,
                  });
                } else {
                  trackAssistant('assistant_undo', { what: event.what });
                }
              }}
              onResolved={(outcome, scope) => {
                reportCommand(outcome, scope, 'agent');
                if (outcome === 'confirmed') hapticSuccess();
              }}
              onAnswer={(followUp, answer) => {
                // A tapped option is the spoken answer, with no clip in between.
                reportCommand('clarified', 'group', 'agent');
                setAgentFollowUp(followUp);
                setAgentSession({ transcript: answer, alternatives: [] });
                setAgentRun((current) => current + 1);
              }}
              onRetry={(followUp) => {
                setAgentFollowUp(followUp ?? null);
                setAgentSession(null);
                setAttempt((current) => current + 1);
                setPhase('listening');
              }}
              onAskAgain={askAgain}
              renderAnswerFollowUps={() => renderAnswerFollowUps(null)}
              onClose={finishVoice}
              onAddAnother={addAnother}
              onStage={setAgentStage}
              onFooter={setPanelFooter}
            />
          ) : phase === 'thinking' ? null : phase === 'review' ? (
            <View style={{ gap: theme.spacing.md }}>
              {/* Confirmation, not an edit form. One open question hides the rest of
                  the review until it is answered; settled, the review is the
                  expense, one plain split line, where it goes, and optional Details. */}
              {question ? (
                renderQuestion()
              ) : (
                <>
                  {preview && !editingDraft ? (
                    <ExpensePreviewCard
                      preview={preview}
                      locale={locale}
                      onEdit={() => setEditingDraft(true)}
                      split={splitProps}
                    />
                  ) : (
                    <>
                      <Card padded={false} style={{ overflow: 'hidden' }}>
                        {drafts.map((draft, index) => (
                          <View key={draft.key}>
                            {index > 0 ? <Divider /> : null}
                            <DraftRow
                              editing={drafts.length === 1 && editingDraft ? true : undefined}
                              draft={draft}
                              // The currency the row shows is the one Save will persist:
                              // the spoken one, else the group's, else the default.
                              currency={voiceSaveCurrency(draft.currency, destCurrency, dc)}
                              locale={locale}
                              onEdit={editDraft}
                              onRemove={drafts.length > 1 ? removeDraft : undefined}
                              fallbackNote={t.voice.anExpense}
                              editLabel={t.common.edit}
                              removeLabel={t.captures.delete}
                              amountLabel={t.captures.amount}
                              noteLabel={t.captures.description}
                              notePlaceholder={t.captures.descriptionPlaceholder}
                            />
                          </View>
                        ))}
                      </Card>
                      {splitProps ? <SplitLine {...splitProps} /> : null}
                    </>
                  )}

                  {/* One destination row: "Save to · <where> · Change". The taxonomy of
                      groups and people only appears once the reader taps it. */}
                  <Card padded={false} style={{ overflow: 'hidden' }}>
                    <Pressable
                      onPress={() => setPickerOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel={`${t.voice.saveTo}: ${current.label}. ${t.voice.change}`}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: theme.spacing.sm,
                        minHeight: 48,
                        paddingHorizontal: theme.spacing.md,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: theme.color.buttonPrimary,
                        }}
                      >
                        {current.emoji ? (
                          <Text style={{ fontSize: 12 }}>{current.emoji}</Text>
                        ) : (
                          <Ionicons
                            name={current.icon}
                            size={iconSize.xs}
                            color={theme.color.onBrand}
                          />
                        )}
                      </View>
                      <Text numberOfLines={1} style={{ flex: 1, color: theme.color.text }}>
                        <Text tone="muted">{t.voice.saveTo}</Text>
                        <Text tone="faint"> · </Text>
                        <Text style={{ fontWeight: '600' }}>{current.label}</Text>
                      </Text>
                      <Text
                        variant="caption"
                        style={{ color: theme.color.brand, fontWeight: '600' }}
                      >
                        {t.voice.change}
                      </Text>
                    </Pressable>
                  </Card>

                  {intent?.hasSocialDetail && dest.kind !== 'existing' ? (
                    <Callout tone="info">{t.voice.needGroupForSplit}</Callout>
                  ) : null}

                  {/* Everything optional behind one row: category and date for a single
                      expense, and the place, read once when the review opened and pinned
                      by default (A43), which rides onto every expense saved from here. */}
                  <Card padded={false} style={{ overflow: 'hidden' }}>
                    <Pressable
                      onPress={() => setDetailsOpen((open) => !open)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: detailsOpen }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        minHeight: 48,
                        paddingHorizontal: theme.spacing.md,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Text tone="muted" style={{ flex: 1 }}>
                        {t.voiceScreen.details}
                      </Text>
                      <Ionicons
                        name={detailsOpen ? 'chevron-up' : 'chevron-down'}
                        size={iconSize.sm}
                        color={theme.color.textFaint}
                      />
                    </Pressable>
                    {detailsOpen && preview && firstDraft ? (
                      <VoiceDetailRows
                        category={preview.category}
                        categoryLabel={categoryLabel}
                        onCategory={(key) => editDraft(firstDraft.key, { category: key })}
                        date={voiceExpenseDate}
                        onDate={setVoiceExpenseDate}
                      />
                    ) : null}
                  </Card>
                  {detailsOpen ? (
                    <LocationField value={location} onChange={handleLocationChange} compact />
                  ) : null}
                </>
              )}
            </View>
          ) : phase === 'saved' && savedResult ? (
            // Saved, and still here: a compact confirmation, then — for one
            // expense — the follow-up questions, answered in place. Add another
            // and Done sit in the footer.
            <View style={{ gap: theme.spacing.md }}>
              {savedResult.kind === 'expense' && !isPro ? (
                renderFreeAfterSave(savedResult.state)
              ) : savedResult.kind === 'expense' ? (
                <VoiceFollowUps
                  initial={savedResult.state}
                  groupWrite={savedResult.write}
                  local={agentLocal}
                  today={today()}
                  onClose={finishVoice}
                  onUndoable={setSavedHandoff}
                  renderSavedBar={(bar) => (
                    <AssistantSavedBar
                      context={bar}
                      controls={bar.controls}
                      groupWrite={savedResult.write}
                      local={agentLocal}
                      today={today()}
                      externalEntry={savedHandoff}
                      onEvent={(event) => {
                        if (event.name === 'assistant_correction')
                          trackAssistant('assistant_correction', {
                            field: event.field,
                            path: event.path,
                          });
                        else trackAssistant('assistant_undo', { what: event.what });
                      }}
                    />
                  )}
                />
              ) : (
                <SavedLine line={savedResult.line} theme={theme} />
              )}
            </View>
          ) : phase === 'committing' ? (
            // The Undo window, as one small card under what was heard: what is about
            // to be written and Undo beside it. The stage's status line already says
            // "Adding…", so the card carries no spinner of its own.
            <View
              style={{
                padding: theme.spacing.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.color.surface,
              }}
            >
              <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={iconSize.lg}
                  color={theme.color.brand}
                />
                <Text style={{ flex: 1, fontWeight: '700' }}>{autoBanner?.label ?? ''}</Text>
                {/* Gone once the write has started (Confirm pressed, or the timer
                  fired): an Undo then would reset the screen while the save still
                  lands. */}
                {autoBanner ? (
                  <Button
                    label={t.voice.autoUndo}
                    variant="secondary"
                    size="sm"
                    onPress={cancelAutoCommit}
                  />
                ) : null}
              </Row>
            </View>
          ) : phase === 'answer' ? (
            // Read-only answers with a next question or an explicit handoff.
            <View
              style={{
                alignSelf: 'stretch',
                gap: theme.spacing.lg,
                paddingTop: theme.spacing.md,
              }}
            >
              {answer?.kind === 'owed' ? (
                <OwedCard
                  profileId={viewerId}
                  direction={answer.direction}
                  onLoadingChange={setOwedLoading}
                />
              ) : null}
              {answer?.kind === 'spend' ? (
                <View style={{ alignSelf: 'stretch' }}>
                  <AssistantMoneyAnswer query={answer.query} onNavigate={dismiss} />
                </View>
              ) : null}
              {answer?.kind === 'owed' ||
              answer?.kind === 'spend' ||
              (answer?.kind === 'group' && queryLedger.loading)
                ? null
                : (() => {
                    const line = answerLine();
                    return 'text' in line ? (
                      <Card>
                        <Text style={{ fontWeight: '700', textAlign: 'center' }}>{line.text}</Text>
                      </Card>
                    ) : null;
                  })()}
              {renderAnswerFollowUps(answer)}
            </View>
          ) : (
            // Listening — the mic panel owns the whole capture surface, the miss
            // included. A heard-but-amountless try comes back as `missed`; the mic
            // is the retry, and tapping it (via `onListen`) clears the miss. No
            // warning banner and no separate button stacked around it.
            <View style={{ flexGrow: 1, gap: theme.spacing.lg, paddingTop: theme.spacing.md }}>
              {launchPersonal ? (
                <Text variant="caption" tone="muted" align="center">
                  {t.assistant.personalScope}
                </Text>
              ) : null}
              {typedMode ? (
                <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.lg }}>
                  {noAmount ? (
                    <Callout tone="warning">
                      {basicQuestion ? t.voiceScreen.statusQuestion : t.voice.noAmount}
                    </Callout>
                  ) : null}
                  <AssistantComposer
                    value={typedDraft}
                    onChangeText={setTypedDraft}
                    onSend={submitTyped}
                    onUseMic={() => {
                      setNoAmount(false);
                      setAttempt((current) => current + 1);
                      setTypedMode(false);
                    }}
                  />
                </View>
              ) : (
                <VoiceMicPanel
                  key={attempt}
                  onDone={handleTranscript}
                  streamLive={agentOn && streamsToCloud}
                  agentReady={agentReady}
                  // Once the server has answered, that answer stands (a "not Pro"
                  // needs no consent read); before it, the phone's last answer.
                  agentLastKnown={agentStatusReady ? agentServerOn : agentLastKnown}
                  cloudConsent={agentServerOn ? cloudConsent : 'granted'}
                  onEngine={setEngine}
                  onStage={setCapStage}
                  groupId={launchGroupId}
                  hints={hints}
                  groupNames={groupNames}
                  missed={noAmount}
                  heard={noAmount ? heardText : ''}
                  onSuggestion={pickSuggestion}
                  canPick={canPickSuggestion}
                  autoStart={!noAmount}
                  endSignal={hold.ended}
                  onEndConsumed={() => pushToTalk.take()}
                  onListen={() => {
                    // A capture the reader actually started — mark it live so its
                    // transcript is accepted (and a dismissed one's is not).
                    captureActive.current = true;
                    heardFromLink.current = false;
                    setAgentQuotaNote(false);
                    setNoAmount(false);
                  }}
                />
              )}
              {/* Only while a finger is actually on the bar's mic. It says the one
                thing a held button has to say and the tapped one does not: there
                is a way out that is not "finish the sentence". The chevron points
                the way the finger should go, which is the way the language runs
                backwards — leftwards in English, rightwards in Arabic. */}
              {hold.holding ? (
                <Row gap={theme.spacing.xs} style={{ justifyContent: 'center' }}>
                  <Ionicons
                    name={isRtl() ? 'chevron-forward' : 'chevron-back'}
                    size={iconSize.sm}
                    color={theme.color.textMuted}
                  />
                  <Text variant="caption" tone="muted">
                    {t.voice.slideToCancel}
                  </Text>
                </Row>
              ) : null}
            </View>
          )}
        </ScrollView>
        <VoiceFooter spec={footerSpec} inset={insets.bottom} />
      </KeyboardAvoidingView>

      {/* The destination picker, as a dismissible bottom sheet — the app's one
          Sheet, so it presents, dims and dismisses exactly like every other
          sheet, and its scrim is a modal window that covers the system bars
          rather than a layer inside this screen. */}
      {adOffer.sheet}
      <VoiceConsentSheet
        visible={consentSheetOpen}
        onAllow={voiceConsent.allow}
        onNotNow={() => setConsentDeclined(true)}
      />

      <Sheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        closeLabel={t.common.close}
        title={t.voice.saveTo}
        style={{
          // The picker was drawn on the page colour rather than card white, and
          // the rows inside it are white cards: on `surface` they would vanish.
          backgroundColor: theme.color.bg,
          paddingHorizontal: theme.spacing.xl,
          // A ceiling, so a long list scrolls inside the sheet instead of
          // pushing its own top off the screen. The keyboard is `Sheet`'s
          // business now — it lifts the card by the measured height itself.
          maxHeight: '80%',
        }}
      >
        <SaveToSheet
          // Remount each time the sheet opens, so the tab and the picked
          // people re-seed from the current destination rather than keeping
          // stale state from the last open.
          key={pickerOpen ? 'open' : 'closed'}
          selection={pickerSelection}
          // The "new group" row is offered whenever a name was heard,
          // whatever the destination now stands at.
          createRow={
            requested ? { label: t.voice.newGroupNamed.replace('{name}', requested.name) } : null
          }
          onChoose={(choice) => {
            // A change of destination is a change of group/ghost to make,
            // so drop the once-only latches for the new one.
            groupCreated.current = false;
            ghostMemberIds.current = null;
            // Their own choice of destination settles a spoken name that was in
            // doubt, and the payer and people are read afresh for the new group.
            setGroupChosen(true);
            setWhoEdit(null);
            // 'create' is the picker naming a row, not a destination: the
            // group id and my member id were minted when the name was
            // heard, and this screen holds them.
            if (choice.kind === 'create') {
              if (requested) setDest({ kind: 'create', ...requested });
            } else {
              setDest(choice);
            }
            setPickerOpen(false);
          }}
          onResolvePeople={resolvePeople}
          people={peopleChoices}
          groups={groupRows}
        />
      </Sheet>

      {/* Who shares it, and who paid: the add-expense form's own split editor, in a
          sheet over this screen. It opens on the people (or on the payer's list,
          from the small "Paid by" line). */}
      {splitOpen && who && dest.kind === 'existing' && splitAmount ? (
        <VoiceSplitSheet
          visible
          onClose={() => setSplitOpen(false)}
          groupId={dest.groupId}
          currency={splitCurrency}
          amount={splitAmount}
          initialView={splitView}
          simple={drafts.length > 1}
          seed={splitEditFromParams(
            who.payerId ?? '',
            who.params,
            who.participantIds,
            splitCurrency,
          )}
          onApply={(result) =>
            editWho({
              payerId: result.payerId,
              participantIds: result.participants,
              params: result.params,
            })
          }
        />
      ) : null}
    </View>
  );
}

/** The current destination as a label plus a leading emoji or icon — what the
 * folded "Save to" selector shows before the picker sheet is opened. */
function describeDest(
  dest: Dest,
  groups: GroupRow[],
  t: ReturnType<typeof useStrings>['t'],
  /** What the picker calls the reader, so the folded selector agrees with the
   *  sheet it was chosen in rather than reverting to "Just me". */
  viewerName: string,
  /** Names an unnamed group by its members, as the picker does. */
  labelOf: (group: GroupRow) => string,
): { label: string; emoji?: string | null; icon: React.ComponentProps<typeof Ionicons>['name'] } {
  if (dest.kind === 'unassigned') {
    return { label: t.captures.unassigned, icon: 'file-tray-full-outline' };
  }
  if (dest.kind === 'me') {
    return { label: viewerName, icon: 'person-circle-outline' };
  }
  if (dest.kind === 'create') {
    return {
      label: t.voice.newGroupNamed.replace('{name}', dest.name),
      icon: 'add-circle-outline',
    };
  }
  if (dest.kind === 'people') {
    return {
      label: dest.name,
      icon: dest.ghostNames.length > 1 ? 'people-outline' : 'person-outline',
    };
  }
  const group = groups.find((candidate) => candidate.id === dest.groupId);
  if (!group) return { label: t.captures.unassigned, icon: 'people-outline' };
  return {
    label: labelOf(group),
    emoji: group.cover_emoji,
    icon: GROUP_TYPE_ICON[group.type] ?? 'people-outline',
  };
}

type Strings = ReturnType<typeof useStrings>['t'];
type ThemeT = ReturnType<typeof useTheme>;

/** The success state's line for anything without follow-ups. */
function SavedLine({ line, theme }: { line: string; theme: ThemeT }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surface,
        ...theme.shadow.soft,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} />
      </View>
      <Text variant="subheading" style={{ flex: 1 }}>
        {line}
      </Text>
    </View>
  );
}

/** A member's name as the review writes it: "You" for the speaker. */
function whoName(members: readonly VoiceNameCandidate[], id: string, t: Strings): string {
  const member = members.find((candidate) => candidate.id === id);
  if (!member) return '';
  return member.isMe ? t.voice.youLabel : member.name;
}

/** The split in words when it is not the plain equal one: "Exact · Arjun 300,
 * Meera 200" or "All on Arjun". Null for an equal split. */
function describeSplit(
  who: WhoView,
  members: readonly VoiceNameCandidate[],
  currency: string,
  t: Strings,
): string | null {
  const names = who.participantIds.map((id) => whoName(members, id, t));
  const { params } = who;
  if (params.kind === 'exact') {
    const scale = Number(minorUnitScale(currency));
    const parts = who.participantIds.map(
      (id, index) => `${names[index]} ${Number(params.amounts[id] ?? 0n) / scale}`,
    );
    return t.voice.splitExact.replace('{names}', parts.join(', '));
  }
  if (params.kind === 'percent') {
    const parts = who.participantIds.map(
      (id, index) => `${names[index]} ${(params.basisPoints[id] ?? 0) / 100}%`,
    );
    return t.voice.splitPercent.replace('{names}', parts.join(', '));
  }
  if (who.intent.splitMode === 'full_on' && !who.edited)
    return t.voice.splitFullOn.replace('{names}', names.join(', '));
  return null;
}
