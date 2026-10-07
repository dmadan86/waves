/**
 * The fast path for Pro advanced voice.
 *
 * The streamed Deepgram transcript used to go straight to the `voice-agent` edge
 * function (about 1.5 to 2 s, and a unit of the monthly allowance). Most
 * sentences are plain, though ("I paid 1200 for dinner in Goa split with Ravi and
 * Anu"), and the instant on-device parser reads those exactly. This module
 * decides, from what the parsers actually returned, whether the parse is safe to
 * trust without the AI. When it is, the screen goes straight to the ordinary
 * basic review/confirm UI; when there is any doubt, the agent is called as before.
 *
 * Pure: no React, no network. The rule is "when in doubt, NOT confident" — a
 * wrong "confident" puts a wrong expense on a review the reader may skim, while
 * a wrong "not confident" only costs one AI call.
 */

import {
  resolveIntentPeople,
  type LearnedName,
  type VoiceIntent,
  type VoiceNameCandidate,
  type VoiceParty,
} from '@waves/core';

import {
  amountIsUnambiguous,
  detectAddMember,
  detectBalanceQuery,
  detectMoneyIntent,
  isSafeVoiceAmount,
  matchMemberNames,
  parseVoiceExpense,
  parseVoiceExpenses,
  type VoiceBalanceQuery,
  type VoiceGroupRef,
  type VoiceMoneyIntent,
  type VoiceParseResult,
} from '@/lib/voiceExpense';

/** What every local parser made of one transcript. */
export interface LocalParse {
  transcript: string;
  parse: VoiceParseResult;
  money: VoiceMoneyIntent | null;
  balance: VoiceBalanceQuery | null;
  addMember: { names: string[] } | null;
  /**
   * Why the single-sentence reader refuses the sentence, when it does. A
   * third-party payer ("Renny paid 1200 …") is flagged here and is never taken
   * on the fast path.
   */
  refused: 'unsupported' | 'third-party-payer' | null;
}

/** A 1:1 contact, as the settle/remind/balance paths resolve a name against. */
export interface FastPathContact {
  id: string;
  name: string;
  /** Signed non-zero net balance per currency (positive: they owe me). */
  balances: readonly bigint[];
}

export interface FastPathContext {
  groups: readonly VoiceGroupRef[];
  /** The group the mic was opened in, when it was. */
  currentGroupId?: string | null;
  /** Members of the groups whose members are loaded (at least the current one). */
  membersByGroup?: Readonly<Record<string, readonly VoiceNameCandidate[]>>;
  contacts?: readonly FastPathContact[];
  /**
   * The engine's other hypotheses for the sentence (n-best), best first — the
   * same evidence the basic path reads names and amounts with, so the fast path
   * sees the same "Did you mean" / "A or B" / "₹15 or ₹50?" questions it would.
   */
  alternatives?: readonly string[];
  /** Name corrections this reader confirmed, per group id. */
  learnedByGroup?: Readonly<Record<string, readonly LearnedName[]>>;
  now?: Date;
}

export interface FastPathVerdict {
  confident: boolean;
  /** A short code for why (or which intent), for the dev log and the tests. */
  reason: string;
}

/** Run every local parser, in the order and with the inputs the basic path uses. */
export function parseLocally(transcript: string, context: FastPathContext): LocalParse {
  return {
    transcript,
    parse: parseVoiceExpenses(transcript, context.groups, {
      members: context.currentGroupId
        ? context.membersByGroup?.[context.currentGroupId]
        : undefined,
      currentGroupId: context.currentGroupId,
      now: context.now,
      alternatives: context.alternatives,
      learned: context.currentGroupId
        ? context.learnedByGroup?.[context.currentGroupId]
        : undefined,
    }),
    money: detectMoneyIntent(transcript),
    balance: detectBalanceQuery(transcript),
    addMember: detectAddMember(transcript),
    refused: parseVoiceExpense(transcript, context.groups).refused ?? null,
  };
}

/* Words that say the parser may have dropped, reversed or half-heard something. */
const DROPPED_WORDS =
  /\b(?:refund(?:ed|s)?|cancel(?:led|ed|s)?|delete[ds]?|remove[ds]?|edit(?:ed|s)?|undo|actually|instead|except|never\s*mind|and\s+also|also|and\s+then|then|sorry|wait|recurring|every\s+(?:day|week|month))\b/iu;

/* Money moving between people rather than a thing bought. */
const MONEY_MOVEMENT =
  /\b(?:owe[sd]?|lent|lend|borrow(?:ed)?|loan|gave|give[sn]?|return(?:ed)?|received|paid\s+me|pay\s+me|paying\s+me|back)\b/iu;

/* Hinglish the English-first parser half-reads (it keeps the words as a "note"). */
const HINGLISH =
  /\b(?:ko|ka|ki|ke|hai|hain|tha|thi|dene|diya|diye|liya|liye|mujhe|mera|meri|humne|hum|maine|aaj|kal|parso|wala|wali|aur|bhi|mein|paise|rupaye|udhar)\b/iu;

/* Any letter that is not Latin: Devanagari, Tamil, Arabic and the rest. */
const NON_LATIN_LETTER = /(?![\p{Script=Latin}])\p{L}/u;

const MULTI_MONEY_VERB =
  /\b(?:remind|nudge|settle|pay\s*back|pay\s*off|clear\s+(?:the\s+)?(?:balance|dues?))\b[\s\S]*\b(?:remind|nudge|settle|pay\s*back|pay\s*off|clear\s+(?:the\s+)?(?:balance|dues?))\b/iu;

const MAX_WORDS = 30;

/** Notes the intent parser emits that are ordinary, not doubts. */
function isBenignNote(note: string): boolean {
  return (
    note === 'payer_default_me' || note === 'me_included_by_with' || note.startsWith('name_fuzzy:')
  );
}

const yes = (reason: string): FastPathVerdict => ({ confident: true, reason });
const no = (reason: string): FastPathVerdict => ({ confident: false, reason });

function words(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

/** The single contact a spoken name picks out, by the same matcher the screen uses. */
function oneContact(who: string, context: FastPathContext): FastPathContact | null {
  const contacts = context.contacts ?? [];
  const matched = matchMemberNames(
    who,
    contacts.map((contact) => ({ id: contact.id, name: contact.name })),
  );
  if (matched.length !== 1) return null;
  return contacts.find((contact) => contact.id === matched[0]) ?? null;
}

function moneyVerdict(local: LocalParse, context: FastPathContext): FastPathVerdict {
  const money = local.money;
  if (!money) return no('no-money');
  if (MULTI_MONEY_VERB.test(local.transcript)) return no('several-money-commands');
  const contact = oneContact(money.who, context);
  if (!contact) return no('money-person-not-one-contact');

  const open = contact.balances.filter((net) => net !== 0n);
  if (money.kind === 'remind') {
    // A nudge means something only when they owe me, in exactly one currency.
    if (open.filter((net) => net > 0n).length !== 1) return no('remind-no-single-debt');
    // "remind Ravi to pay 500" carries an amount the nudge does not use.
    if (local.parse.items.length > 0) return no('remind-with-amount');
    return yes('remind');
  }
  if (open.length !== 1) return no('settle-no-single-balance');
  // The engine's other hypotheses hear a different settle amount ("fifteen" /
  // "fifty"): that is a question for the reader, not a guess.
  if (
    (context.alternatives ?? []).some((alternative) => {
      const other = detectMoneyIntent(alternative);
      return other?.kind === 'settle' && other.amount !== money.amount;
    })
  )
    return no('amount-ambiguous');
  // The only expense-looking thing allowed is the settle's own spoken amount.
  const [item] = local.parse.items;
  if (local.parse.items.length > 1) return no('settle-with-expense');
  if (item && item.amountMajor !== money.amount) return no('settle-with-expense');
  return yes('settle');
}

function balanceVerdict(local: LocalParse, context: FastPathContext): FastPathVerdict {
  const query = local.balance;
  if (!query) return no('no-balance');
  if (local.parse.items.length > 0) return no('balance-with-amount');
  if (query.kind === 'person') {
    // Resolving to nobody is an answer the screen can give, but it is a miss
    // here: the agent may know who was meant.
    return oneContact(query.who, context) ? yes('balance-person') : no('balance-person-unknown');
  }
  const { group, intent } = local.parse;
  if (
    group?.kind === 'existing' &&
    intent?.groupSource === 'named' &&
    intent.targetGroupId === group.groupId &&
    context.groups.some((candidate) => candidate.id === group.groupId && candidate.name?.trim())
  )
    return yes('balance-group');
  return no('balance-group-unresolved');
}

/**
 * Only the resolver's "auto" tier counts: a name it would merely suggest ("Did
 * you mean Renny?"), one it would ask to choose between ("Ravi or Rajiv?"), or
 * one only another hypothesis heard, is a question for the reader.
 */
function partyProblem(party: VoiceParty): string | null {
  if (party.status === 'me') return null;
  if (party.status === 'resolved') return party.alternativeOnly ? 'name-alternative-only' : null;
  if (party.status === 'suggested') return 'name-suggested';
  return party.status === 'ambiguous' ? 'name-ambiguous' : 'name-unresolved';
}

function expenseVerdict(local: LocalParse, context: FastPathContext): FastPathVerdict {
  const { parse } = local;
  if (parse.items.length !== 1) return no(parse.items.length === 0 ? 'no-expense' : 'many-items');
  const [item] = parse.items;
  if (!item || !isSafeVoiceAmount(item.amountMajor)) return no('bad-amount');
  // "₹15 or ₹50?", "total or each?", "US or Australian dollars?" — a chooser the
  // review would show is never skipped.
  if (!amountIsUnambiguous(parse)) return no('amount-ambiguous');
  if (parse.group?.kind === 'create') return no('creates-group');

  // Solo spend: the destination is the private ledger, nobody to resolve.
  if (parse.personal && parse.group === null) return yes('expense-personal');

  const intent = parse.intent;
  if (!intent) return no('no-intent');
  if (intent.items && intent.items.length > 1) return no('many-items');
  if (intent.splitMode !== 'equal') return no('non-equal-split');
  if (/\b(?:split|between|among|share[ds]?|each)\b/iu.test(parse.peopleText ?? ''))
    return no('unread-split-clause');

  // Destination: a group named (and found), or the group the mic was opened in.
  let groupId: string;
  if (parse.group?.kind === 'existing') {
    groupId = parse.group.groupId;
    // A group chosen only because a word of the note overlaps its name (the
    // "lunch" in "500 for lunch" and a group called "Office Lunch") is a guess.
    if (intent.targetGroupId !== groupId) return no('group-by-word-overlap');
    if (intent.groupSource !== 'named' && intent.groupSource !== 'current')
      return no('group-by-word-overlap');
  } else if (parse.group === null && intent.groupSource === 'current' && context.currentGroupId) {
    groupId = context.currentGroupId;
  } else {
    return no(`group-${intent.groupSource}`);
  }
  if (!context.groups.some((group) => group.id === groupId)) return no('group-unknown');

  // Who: re-read the spoken names against the members of the group it lands in
  // (the parse only saw the launch group's), so the same words mean the right people.
  const spoken: VoiceParty[] = [intent.payer, ...(intent.participants ?? [])];
  const needsMembers = spoken.some((party) => party.kind === 'member');
  const members = context.membersByGroup?.[groupId];
  if (needsMembers && !members) return no('members-unknown');
  const reread: VoiceIntent = members
    ? resolveIntentPeople(
        {
          ...intent,
          // Stale doubts from the first read are replaced by this one.
          notes: intent.notes.filter((note) => !note.startsWith('name_')),
        },
        members,
        { learned: context.learnedByGroup?.[groupId] },
      )
    : intent;
  for (const party of [reread.payer, ...(reread.participants ?? [])]) {
    const problem = partyProblem(party);
    if (problem) return no(problem);
  }

  const doubt = reread.notes.find((note) => !isBenignNote(note));
  if (doubt) return no(`note:${doubt}`);

  // A spoken head count has to agree with the people actually named.
  const count = intent.splitCount ?? parse.splitCount;
  if (count != null && count !== (reread.participants?.length ?? -1)) return no('split-count');
  return yes('expense');
}

/**
 * Whether the local parse can be trusted without the AI.
 *
 * Confident means exactly one recognised intent (a single expense, a settle or
 * remind, or a balance query), with a positive amount where one applies, the
 * destination and every named person resolved to exactly one match, and nothing
 * in the sentence the parsers are known to drop. Everything else is not.
 */
export function explainLocalParse(local: LocalParse, context: FastPathContext): FastPathVerdict {
  const text = local.transcript.trim();
  if (!text) return no('empty');
  if (words(text) > MAX_WORDS) return no('too-long');
  if (NON_LATIN_LETTER.test(text)) return no('non-latin-script');
  if (HINGLISH.test(text)) return no('hinglish');
  if (DROPPED_WORDS.test(text)) return no('dropped-words');
  if (MONEY_MOVEMENT.test(text) && !local.money && !local.balance) return no('money-movement');

  // Intents the fast path does not take (adding a member, making a group) and
  // the parser's own refusals are never confident.
  if (local.addMember) return no('add-member');
  if (local.parse.group?.kind === 'create') return no('creates-group');
  // "Renny paid 1200 …": the single-sentence reader refuses a third-party payer.
  if (local.refused === 'third-party-payer') return no('third-party-payer');
  // Any amount the review would ask about ("₹15 or ₹50?") — whatever the intent.
  if (local.parse.items.length > 0 && !amountIsUnambiguous(local.parse))
    return no('amount-ambiguous');

  const candidates: [string, FastPathVerdict][] = [];
  if (local.money) candidates.push(['money', moneyVerdict(local, context)]);
  else if (local.balance) candidates.push(['balance', balanceVerdict(local, context)]);
  else if (local.parse.items.length > 0)
    candidates.push(['expense', expenseVerdict(local, context)]);

  // A balance question that also reads as a money command (or the reverse) is
  // two intents, however each would resolve alone.
  if (local.money && local.balance) return no('several-intents');
  if (candidates.length !== 1) return no('no-intent');
  const [, verdict] = candidates[0];
  return verdict;
}

export function localParseIsConfident(local: LocalParse, context: FastPathContext): boolean {
  return explainLocalParse(local, context).confident;
}
