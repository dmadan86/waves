/**
 * The voice test recorder's pure half: which sentences a tester is asked to
 * read, and the manifest that describes what they recorded.
 *
 * The recordings feed the name/amount recognition bench, so the prompts are
 * built from the tester's own groups and members (the names the recogniser has
 * to get right for them), plus a fixed set of amount phrasings and
 * "no person, no amount" traps. Everything is a function of its inputs and a
 * seed — no clock, no Math.random — so the same groups give the same session.
 */

export type PromptKind = 'name' | 'amount' | 'trap';

export type PromptRole =
  'expense' | 'split' | 'settle' | 'remind' | 'balance_query' | 'add_member' | 'amount' | 'none';

/** What the recogniser should end up with for a prompt, for the bench to score. */
export interface PromptExpected {
  /** Member display names that must be recognised, in the order spoken. */
  names: string[];
  /** The amount in minor units, or null when the sentence carries none. */
  amountMinor: number | null;
  currency: string | null;
  role: PromptRole;
}

export interface RecorderPrompt {
  id: string;
  kind: PromptKind;
  text: string;
  expected: PromptExpected;
}

/** One group as the generator needs it: members other than the tester. */
export interface RecorderGroup {
  name: string;
  currency: string;
  members: readonly string[];
}

export const DEFAULT_PROMPT_COUNT = 40;
const NAME_SHARE = 25;
const AMOUNT_SHARE = 10;
const TRAP_SHARE = 5;
/** The first few amount phrasings (lakh, "sorry", dedh sau…) are in every session. */
const ALWAYS_AMOUNTS = 4;
const FALLBACK_CURRENCY = 'INR';

/** Currencies with no minor unit, so "500" is 500 and not 50000. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX']);

export function toMinor(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency) ? amount : amount * 100;
}

/** mulberry32: a tiny seeded generator, so a session is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

interface AmountPhrase {
  text: string;
  /** Major units (rupees etc.), converted with the session currency. */
  amount: number;
  role: PromptRole;
}

/** Fixed amount phrasings: lakh, "sorry" corrections, mixed and local number words. */
export const AMOUNT_PHRASES: readonly AmountPhrase[] = [
  { text: 'one point five lakh for the car', amount: 150000, role: 'expense' },
  { text: 'five hundred each for three people', amount: 500, role: 'expense' },
  { text: 'fifteen sorry fifty for snacks', amount: 50, role: 'expense' },
  { text: 'dedh sau for chai', amount: 150, role: 'expense' },
  { text: 'paanch sau rupaye auto ke liye', amount: 500, role: 'expense' },
  { text: 'dhai hazaar ka petrol', amount: 2500, role: 'expense' },
  { text: 'do hazaar paanch sau groceries', amount: 2500, role: 'expense' },
  { text: 'ஐநூறு ரூபாய் டீக்கு', amount: 500, role: 'expense' },
  { text: 'aayiram rupai for petrol', amount: 1000, role: 'expense' },
  { text: 'irunooru fifty for tiffin', amount: 250, role: 'expense' },
  { text: 'पाँच सौ रुपये चाय के लिए', amount: 500, role: 'expense' },
  { text: 'twelve thousand three hundred for the hotel', amount: 12300, role: 'expense' },
];

/** Sentences with no person and no amount, which must not produce either. */
export const TRAP_PHRASES: readonly string[] = [
  'bought a new phone',
  'rainy day taxi paid by me 200',
  'table for two at 7',
  'the bill came to a lot more than expected',
  'meet at gate number five',
  'I will pay you tomorrow',
  'one for the road',
];

/** Rainy-day taxi has a real amount; every other trap has none. */
const TRAP_AMOUNTS: Readonly<Record<string, number>> = { 'rainy day taxi paid by me 200': 200 };

const NAME_AMOUNTS = [120, 200, 300, 450, 500, 800, 1200, 1500, 2400, 3500];
const NAME_ITEMS = ['dinner', 'lunch', 'cab', 'tickets', 'groceries', 'coffee', 'petrol', 'movie'];

type NameTemplate = (ctx: {
  a: string;
  b: string | null;
  group: string;
  amount: number;
  item: string;
}) => { text: string; names: string[]; amount: number | null; role: PromptRole; group?: string };

const NAME_TEMPLATES: readonly NameTemplate[] = [
  ({ a, amount, item }) => ({
    text: `${a} paid ${amount} for ${item}`,
    names: [a],
    amount,
    role: 'expense',
  }),
  ({ a, b, amount }) => ({
    text: b ? `Split ${amount} between me, ${a} and ${b}` : `Split ${amount} between me and ${a}`,
    names: b ? [a, b] : [a],
    amount,
    role: 'split',
  }),
  ({ a }) => ({ text: `8000 for ${a}`, names: [a], amount: 8000, role: 'expense' }),
  ({ a }) => ({ text: `Remind ${a} to pay`, names: [a], amount: null, role: 'remind' }),
  ({ a, amount }) => ({
    text: `${a} paid me back ${amount}`,
    names: [a],
    amount,
    role: 'settle',
  }),
  ({ a }) => ({
    text: `How much does ${a} owe me`,
    names: [a],
    amount: null,
    role: 'balance_query',
  }),
  ({ a, group }) => ({
    text: `Add ${a} to ${group}`,
    names: [a],
    amount: null,
    role: 'add_member',
  }),
];

/**
 * About `count` prompts for these groups, in a seeded order. Name prompts come
 * from the real members (as many as the data allows), the rest from the fixed
 * amount and trap pools; a shortfall in one pool is made up from the others so a
 * tester with no groups still gets a full session.
 */
export function generatePrompts(input: {
  groups: readonly RecorderGroup[];
  seed: number;
  count?: number;
}): RecorderPrompt[] {
  const count = input.count ?? DEFAULT_PROMPT_COUNT;
  const random = mulberry32(input.seed);
  const groups = input.groups.filter((group) => group.members.length > 0);
  const currency = input.groups[0]?.currency ?? FALLBACK_CURRENCY;

  // Every (member, group) pair once, shuffled; names stay unique per prompt.
  const pairs = shuffled(
    groups.flatMap((group) => uniqueNames(group.members).map((name) => ({ name, group }))),
    random,
  );
  const nameWanted = pairs.length === 0 ? 0 : NAME_SHARE;
  const name: RecorderPrompt[] = [];
  for (let i = 0; i < nameWanted; i++) {
    const pair = pairs[i % pairs.length]!;
    const others = uniqueNames(pair.group.members).filter((n) => n !== pair.name);
    const second = others.length > 0 ? others[Math.floor(random() * others.length)]! : null;
    // Walk the templates in order so every phrasing is covered before repeating.
    const template = NAME_TEMPLATES[i % NAME_TEMPLATES.length]!;
    const built = template({
      a: pair.name,
      b: second,
      group: pair.group.name,
      amount: NAME_AMOUNTS[Math.floor(random() * NAME_AMOUNTS.length)]!,
      item: NAME_ITEMS[Math.floor(random() * NAME_ITEMS.length)]!,
    });
    const cur = pair.group.currency || currency;
    name.push({
      id: '',
      kind: 'name',
      text: built.text,
      expected: {
        names: built.names,
        amountMinor: built.amount === null ? null : toMinor(built.amount, cur),
        currency: built.amount === null ? null : cur,
        role: built.role,
      },
    });
  }

  const amounts: RecorderPrompt[] = [
    ...AMOUNT_PHRASES.slice(0, ALWAYS_AMOUNTS),
    ...shuffled(AMOUNT_PHRASES.slice(ALWAYS_AMOUNTS), random),
  ].map((phrase) => ({
    id: '',
    kind: 'amount',
    text: phrase.text,
    expected: {
      names: [],
      amountMinor: toMinor(phrase.amount, currency),
      currency,
      role: phrase.role,
    },
  }));
  const traps: RecorderPrompt[] = shuffled(TRAP_PHRASES, random).map((text) => {
    const amount = TRAP_AMOUNTS[text];
    return {
      id: '',
      kind: 'trap',
      text,
      expected: {
        names: [],
        amountMinor: amount === undefined ? null : toMinor(amount, currency),
        currency: amount === undefined ? null : currency,
        role: 'none',
      },
    };
  });

  const nameCount = Math.min(name.length, NAME_SHARE);
  const trapCount = Math.min(traps.length, TRAP_SHARE);
  const amountCount = Math.min(
    amounts.length,
    Math.max(AMOUNT_SHARE, count - nameCount - trapCount),
  );
  const picked = [
    ...name.slice(0, nameCount),
    ...amounts.slice(0, amountCount),
    ...traps.slice(0, trapCount),
  ];
  const ordered = shuffled(picked, random).slice(0, count);
  return ordered.map((prompt, index) => ({
    ...prompt,
    id: `p${String(index + 1).padStart(2, '0')}`,
  }));
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// ──────────────────────────────────────────────────────────── manifest ──

export interface OnDeviceResult {
  /** Up to five alternatives the phone's own recogniser returned. */
  alternatives: string[];
  /** Why there are none, when there are none ("unsupported", "no-speech"…). */
  note?: string;
}

export interface ManifestItem {
  id: string;
  promptText: string;
  expected: PromptExpected;
  file: string;
  durationMs: number;
  recordedAt: string;
  onDevice?: OnDeviceResult;
}

export interface ManifestSpeaker {
  label: string;
  languageBackground: string | null;
  accent: string | null;
}

export interface ManifestDevice {
  model: string;
  os: string;
  osVersion: string;
  appVersion: string;
  locale: string;
}

export interface RecorderManifest {
  version: 1;
  sessionId: string;
  createdAt: string;
  speaker: ManifestSpeaker;
  device: ManifestDevice;
  audio: { format: 'wav'; sampleRate: 16000; channels: 1; bitDepth: 16 };
  onDeviceRecognition: 'supported' | 'unsupported';
  /** The full plan for the session, so an interrupted one can resume. */
  prompts: RecorderPrompt[];
  items: ManifestItem[];
}

export function buildManifest(input: {
  sessionId: string;
  createdAt: string;
  speaker: ManifestSpeaker;
  device: ManifestDevice;
  onDeviceSupported: boolean;
  prompts: readonly RecorderPrompt[];
  items: readonly ManifestItem[];
}): RecorderManifest {
  return {
    version: 1,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    speaker: { ...input.speaker, label: input.speaker.label.trim() },
    device: input.device,
    audio: { format: 'wav', sampleRate: 16000, channels: 1, bitDepth: 16 },
    onDeviceRecognition: input.onDeviceSupported ? 'supported' : 'unsupported',
    prompts: [...input.prompts],
    items: [...input.items],
  };
}

/** One item per prompt id: a re-record replaces the earlier take. */
export function upsertItem(items: readonly ManifestItem[], item: ManifestItem): ManifestItem[] {
  const rest = items.filter((existing) => existing.id !== item.id);
  return [...rest, item].sort((a, b) => a.id.localeCompare(b.id));
}

/** The first prompt without a recording, or the count when all are done. */
export function nextUnrecorded(
  prompts: readonly RecorderPrompt[],
  items: readonly ManifestItem[],
): number {
  const done = new Set(items.map((item) => item.id));
  const index = prompts.findIndex((prompt) => !done.has(prompt.id));
  return index === -1 ? prompts.length : index;
}

/** Folder name for a session, filesystem-safe and sortable. */
export function sessionIdFor(date: Date): string {
  return `session-${date.toISOString().replace(/[:.]/g, '-')}`;
}
