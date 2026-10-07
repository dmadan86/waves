/**
 * The spoken-name bench: real recogniser mishearings, scored end to end.
 *
 * `fixtures/voice-names.json` holds ~300 first names from the places Waves is
 * used (Tamil, Hindi, Telugu, Malayalam, Kannada, Bengali/Marathi, Arabic and
 * English). Each was spoken in three carrier sentences by macOS voices (Indian
 * English, Hindi, Tamil, Telugu, Kannada, Arabic, British, American and
 * Australian), and the audio was transcribed by Deepgram Nova-3 (en-IN and
 * multi, no keyterm boosting) and by Apple's on-device recogniser (en-IN and
 * en-US). `fixtures/voice-names-heard.json` is what came back.
 *
 * Every case drops the target into a seeded group of 3–8 people — the speaker,
 * a couple of names that sound or spell alike, and a few strangers — and runs
 * the whole sentence through `parseVoiceIntent`. A case lands in the tier the
 * review screen would show (see `Outcome`): filled in (right or wrong — the
 * wrong one is what costs money), "Did you mean …?", "A or B?", or nobody.
 *
 * Further sections read the same utterances with the sibling engine's
 * transcript as an n-best alternative, replay learned corrections, and check
 * ~620 sentences that name nobody (220 of them built to sound like somebody).
 *
 * Deterministic: no randomness beyond a seeded generator, no network.
 */

import { describe, expect, it } from 'vitest';

import {
  parseVoiceIntent,
  type VoiceIntent,
  type VoiceIntentContext,
  type VoiceParty,
} from '../src/voice/intent';
import { isMeWord, type VoiceNameCandidate } from '../src/voice/names';

import heardFixture from './fixtures/voice-names-heard.json';
import namesFixture from './fixtures/voice-names.json';

interface NameRow {
  readonly name: string;
  readonly origin: string;
}
interface HeardFixture {
  readonly engines: readonly string[];
  readonly carriers: readonly string[];
  /** [name, voice, carrier index, engine index, transcript] */
  readonly cases: readonly (readonly [string, string, number, number, string])[];
}

const NAMES = namesFixture as NameRow[];
const HEARD = heardFixture as unknown as HeardFixture;

/** VOICE_BENCH_VERBOSE=1 lists every wrong-person case. */
const VERBOSE = Boolean(
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    .VOICE_BENCH_VERBOSE,
);

const SURNAMES = [
  'Kumar',
  'Sharma',
  'Nair',
  'Reddy',
  'Iyer',
  'Khan',
  'Patel',
  'Menon',
  'Pillai',
  'Gupta',
  'Smith',
  'Jones',
  'Williams',
  'Al Mansoori',
  'Haddad',
  'Rao',
  'Joseph',
  'Thomas',
];

/** Pairs a careless matcher confuses; each pulls the other into the group. */
const CONFUSABLE: readonly (readonly [string, string])[] = [
  ['Ravi', 'Rajiv'],
  ['Ravi', 'Rajeev'],
  ['Rajiv', 'Rajeev'],
  ['Priya', 'Piya'],
  ['Priya', 'Riya'],
  ['Anu', 'Anand'],
  ['Anu', 'Anusha'],
  ['Anil', 'Sunil'],
  ['Amit', 'Ankit'],
  ['Sumit', 'Amit'],
  ['Rohit', 'Rahul'],
  ['Suresh', 'Ramesh'],
  ['Ramesh', 'Mahesh'],
  ['Rakesh', 'Rajesh'],
  ['Madan', 'Madhan'],
  ['Arun', 'Tarun'],
  ['Varun', 'Tarun'],
  ['Ajay', 'Vijay'],
  ['Neha', 'Sneha'],
  ['Meena', 'Megha'],
  ['Divya', 'Vidya'],
  ['Shreya', 'Shweta'],
  ['Swetha', 'Shwetha'],
  ['Hassan', 'Hussein'],
  ['Ahmed', 'Hamad'],
  ['Hamad', 'Hamdan'],
  ['Mohammed', 'Hamad'],
  ['Saeed', 'Saif'],
  ['Reem', 'Renny'],
  ['Sam', 'Sai'],
  ['Ben', 'Benita'],
  ['Renny', 'Ravi'],
  ['Kate', 'Kavya'],
  ['Hari', 'Harry'],
  ['Dev', 'Deepa'],
  ['Matthew', 'Mathu'],
  ['Muthu', 'Madhan'],
  ['Shaji', 'Shibu'],
  ['Biju', 'Bindu'],
  ['Manju', 'Manoj'],
  ['Sajeev', 'Rajeev'],
];

/** mulberry32: a tiny seeded generator, so every run builds the same groups. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const keep = row[j] ?? 0;
      row[j] = Math.min(
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = keep;
    }
  }
  return row[b.length] ?? 0;
}

/** Names spelled alike — same first letter, two edits or fewer — chosen without the matcher. */
function lookAlikes(target: string): string[] {
  const t = target.toLowerCase();
  const paired = CONFUSABLE.flatMap(([a, b]) => (a === target ? [b] : b === target ? [a] : []));
  const spelled = NAMES.map((row) => row.name).filter(
    (name) =>
      name !== target &&
      name[0] === target[0] &&
      editDistance(name.toLowerCase(), t) <= Math.max(2, Math.floor(t.length / 3)),
  );
  return [...new Set([...paired, ...spelled])];
}

function buildGroup(target: string, seed: number): VoiceNameCandidate[] {
  const rand = mulberry32(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const size = 3 + Math.floor(rand() * 6);
  const chosen = [target];
  const similar = lookAlikes(target);
  const wantSimilar = Math.min(similar.length, 1 + Math.floor(rand() * 2), size - 2);
  while (chosen.length - 1 < wantSimilar) {
    const name = pick(similar);
    if (!chosen.includes(name)) chosen.push(name);
  }
  while (chosen.length < size) {
    const name = pick(NAMES).name;
    if (!chosen.includes(name)) chosen.push(name);
  }
  // The speaker is one of the group (never the target), sometimes with a surname.
  const speaker = 1 + Math.floor(rand() * (chosen.length - 1));
  return chosen.map((name, i) => ({
    id: `m${i}`,
    name: rand() < 0.3 ? `${name} ${pick(SURNAMES)}` : name,
    ...(i === speaker ? { isMe: true } : {}),
  }));
}

/**
 * What one case came to, by the tier the screen would show:
 *
 * - auto: the target was filled in without a question;
 * - autoWrong: somebody else was filled in (the outcome that costs money);
 * - suggest / suggestWrong: "Did you mean …?" offered the target / somebody else;
 * - choose / chooseMiss: "A or B?" with / without the target among them;
 * - unknown: nobody offered.
 */
type Outcome =
  'auto' | 'autoWrong' | 'suggest' | 'suggestWrong' | 'choose' | 'chooseMiss' | 'unknown';
const OUTCOMES: readonly Outcome[] = [
  'auto',
  'autoWrong',
  'suggest',
  'suggestWrong',
  'choose',
  'chooseMiss',
  'unknown',
];

type Tally = Record<Outcome, number>;
const emptyTally = (): Tally =>
  Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Tally;

const NOW = new Date('2026-10-01T12:00:00Z');

/** The tier one parsed sentence reached for `target`. */
function classify(
  intent: VoiceIntent,
  transcript: string,
  carrier: number,
  target: string,
): Outcome {
  const parties: VoiceParty[] = [intent.payer, ...(intent.participants ?? [])];
  // "me" heard where the name was ("we paid 500" for Vijay) is a recogniser
  // loss, not a wrong guess; the speaker matched by sound is a wrong guess.
  const meWords = transcript
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word && isMeWord(word)).length;
  const spokenMe = carrier === 1 ? meWords > 1 : meWords > 0;
  let auto = false;
  let wrong = false;
  let suggest: 'right' | 'wrong' | null = null;
  let choose: 'right' | 'miss' | null = null;
  for (const party of parties) {
    const status = party.status as string;
    if (status === 'resolved') {
      if (party.memberId === target) auto = true;
      else wrong = true;
    } else if (status === 'suggested') {
      const right = party.candidates?.[0]?.id === target;
      suggest = suggest === 'right' || right ? 'right' : 'wrong';
    } else if (status === 'ambiguous') {
      const right = (party.candidates ?? []).some((c) => c.id === target);
      choose = choose === 'right' || right ? 'right' : 'miss';
    }
  }
  const payerIsMeByName = intent.payer.status === 'me' && intent.payer.explicit && !spokenMe;
  const extraMe =
    !spokenMe &&
    carrier !== 1 &&
    (intent.participants ?? []).some((party) => party.status === 'me');
  if (wrong || payerIsMeByName || extraMe) return 'autoWrong';
  if (auto) return 'auto';
  if (suggest) return suggest === 'right' ? 'suggest' : 'suggestWrong';
  if (choose) return choose === 'right' ? 'choose' : 'chooseMiss';
  return 'unknown';
}

function judge(
  transcript: string,
  carrier: number,
  members: VoiceNameCandidate[],
  extra: Partial<VoiceIntentContext> = {},
): Outcome {
  const intent = parseVoiceIntent(transcript, { members, now: NOW, ...extra });
  return classify(intent, transcript, carrier, members[0]?.id ?? '');
}

function run(): { byEngine: Map<string, Tally>; total: Tally; wrongCases: string[] } {
  const byEngine = new Map<string, Tally>();
  const total = emptyTally();
  const wrongCases: string[] = [];
  HEARD.cases.forEach(([name, voice, carrier, engine, transcript], index) => {
    const members = buildGroup(name, index + 1);
    const outcome = judge(transcript, carrier, members);
    const engineName = HEARD.engines[engine] ?? String(engine);
    const tally = byEngine.get(engineName) ?? emptyTally();
    tally[outcome] += 1;
    total[outcome] += 1;
    byEngine.set(engineName, tally);
    if (outcome === 'autoWrong')
      wrongCases.push(
        `${name} [${voice}, ${engineName}] "${transcript}" in {${members.map((m) => m.name).join(', ')}}`,
      );
  });
  return { byEngine, total, wrongCases };
}

const count = (t: Tally): number => OUTCOMES.reduce((sum, outcome) => sum + t[outcome], 0);
const pct = (part: number, whole: number): string => `${((100 * part) / whole).toFixed(2)}%`;

/** One line of the report: every tier as a share of the cases. */
function line(label: string, t: Tally): string {
  const n = count(t);
  return [
    `${label.padEnd(24)} n=${String(n).padStart(5)}`,
    `auto ${pct(t.auto, n)}`,
    `auto-wrong ${pct(t.autoWrong, n)}`,
    `suggest ${pct(t.suggest + t.suggestWrong, n)} (wrong ${t.suggestWrong})`,
    `choose ${pct(t.choose + t.chooseMiss, n)} (miss ${t.chooseMiss})`,
    `unknown ${pct(t.unknown, n)}`,
  ].join('  ');
}

/**
 * Ratchets: raise the floor and lower the ceiling as the matcher improves.
 * Most of what is left wrong is the recogniser writing another member's real
 * name ("rakesh" for Rajeesh with a Rakesh in the group), which no matcher can
 * undo; most of what is left unknown has no trace of the name left in it.
 */
const WRONG_CEILING = 0.0007;
const AUTO_FLOOR = 0.63;
/**
 * Each bench test parses thousands of whole sentences; on a shared CI runner
 * that takes 5-15 s, past vitest's 5 s default. The limit is explicit here
 * rather than raised for every test in the package.
 */
const BENCH = { timeout: 60_000 };
/** Filled in or offered as the one suggestion. */
const COVERAGE_FLOOR = 0.73;

describe('spoken-name bench (real recogniser transcripts)', BENCH, () => {
  const { byEngine, total, wrongCases } = run();
  const n = count(total);

  it('reports each tier by engine', () => {
    const lines = [...byEngine].map(([engine, t]) => line(engine, t));
    lines.push(line('all', total));
    if (VERBOSE) lines.push(...wrongCases);
    console.log(lines.join('\n'));
    expect(n).toBe(HEARD.cases.length);
  });

  it('fills in the wrong person almost never', () => {
    expect(total.autoWrong / n).toBeLessThanOrEqual(WRONG_CEILING);
  });

  it('fills in the right person in most cases', () => {
    expect(total.auto / n).toBeGreaterThanOrEqual(AUTO_FLOOR);
  });

  it('fills in or suggests the right person in more', () => {
    expect((total.auto + total.suggest) / n).toBeGreaterThanOrEqual(COVERAGE_FLOOR);
  });
});

/**
 * N-best, approximated: the fixtures hold one transcript per engine, so each
 * utterance is read with its sibling engine's transcript as the alternative
 * hypothesis (Apple en-IN with en-US, Deepgram en-IN with multi), the way the
 * phone hands over its other hypotheses. Siblings are often identical, which is
 * what the one-vote-per-sound-cluster rule is for.
 */
function runNBest(): { single: Tally; nbest: Tally } {
  const single = emptyTally();
  const nbest = emptyTally();
  const sibling = new Map<string, string>();
  HEARD.cases.forEach(([name, voice, carrier, engine, transcript]) =>
    sibling.set(`${name}|${voice}|${carrier}|${engine}`, transcript),
  );
  HEARD.cases.forEach(([name, voice, carrier, engine, transcript], index) => {
    const pair = engine % 2 === 0 ? engine + 1 : engine - 1;
    const other = sibling.get(`${name}|${voice}|${carrier}|${pair}`);
    if (other === undefined) return;
    const members = buildGroup(name, index + 1);
    single[judge(transcript, carrier, members)] += 1;
    nbest[judge(transcript, carrier, members, { alternatives: [other] })] += 1;
  });
  return { single, nbest };
}

/**
 * Learned corrections, replayed: what the recogniser made of a name in the
 * first carrier sentence is confirmed by the user as the right person (once, or
 * twice), then the other two sentences are read again in the same group.
 */
function runLearned(): { before: Tally; once: Tally; twice: Tally } {
  const before = emptyTally();
  const once = emptyTally();
  const twice = emptyTally();
  const heardFirst = new Map<string, string[]>();
  HEARD.cases.forEach(([name, , carrier, engine, transcript], index) => {
    if (carrier !== 0) return;
    const members = buildGroup(name, index + 1);
    const intent = parseVoiceIntent(transcript, { members, now: NOW });
    const slot = [intent.payer, ...(intent.participants ?? [])].find(
      (party) => party.kind === 'member' && party.status !== 'resolved' && party.heard,
    );
    const key = `${name}|${engine}`;
    if (slot?.heard) heardFirst.set(key, [...(heardFirst.get(key) ?? []), slot.heard]);
  });
  HEARD.cases.forEach(([name, , carrier, engine, transcript], index) => {
    if (carrier === 0) return;
    const heard = heardFirst.get(`${name}|${engine}`);
    if (heard === undefined) return;
    const members = buildGroup(name, index + 1);
    const memberId = members[0]?.id ?? '';
    const learned = (count: number) => heard.map((phrase) => ({ heard: phrase, memberId, count }));
    before[judge(transcript, carrier, members)] += 1;
    once[judge(transcript, carrier, members, { learned: learned(1) })] += 1;
    twice[judge(transcript, carrier, members, { learned: learned(2) })] += 1;
  });
  return { before, once, twice };
}

describe('spoken-name bench: more evidence than one transcript', BENCH, () => {
  it('reads the other hypotheses without filling in more wrong people', () => {
    const { single, nbest } = runNBest();
    console.log([line('one hypothesis', single), line('with alternative', nbest)].join('\n'));
    expect(nbest.autoWrong).toBeLessThanOrEqual(single.autoWrong);
    expect(nbest.auto + nbest.suggest).toBeGreaterThanOrEqual(single.auto + single.suggest);
  });

  it('learns a confirmed mishearing for the group, within bounds', () => {
    const { before, once, twice } = runLearned();
    console.log(
      [
        line('learned: none', before),
        line('learned: once', once),
        line('learned: twice', twice),
      ].join('\n'),
    );
    expect(once.autoWrong).toBeLessThanOrEqual(before.autoWrong);
    expect(twice.auto).toBeGreaterThan(before.auto);
  });
});

/** What people spend on, in the words they use for it in India, the Gulf, the UK and Australia. */
const SPENDS = [
  'groceries from big bazaar',
  'auto fare',
  'chai and samosa',
  'movie tickets at pvr',
  'biryani from paradise',
  'uber to the airport',
  'petrol',
  'electricity bill',
  'wifi recharge',
  'maid salary',
  'milk and bread',
  'netflix subscription',
  'shawarma',
  'karak chai',
  'metro card',
  'parking',
  'toll',
  'pharmacy',
  'gym membership',
  'dinner at nandos',
  'fish and chips',
  'pints at the pub',
  'tesco shopping',
  'sainsburys',
  'woolies',
  'aldi',
  'bunnings',
  'brunch',
  'flat white',
  'masala dosa',
  'idli vada',
  'vada pav',
  'pani puri',
  'rickshaw',
  'ola cab',
  'careem ride',
  'talabat order',
  'zomato order',
  'swiggy',
  'lulu hypermarket',
  'carrefour',
  'desert safari',
  'visa fees',
  'hotel booking',
  'flight tickets',
  'train tickets',
  'bus pass',
  'birthday cake',
  'gift for mom',
  'flowers',
  'tailor',
  'laundry',
  'haircut',
  'doctor visit',
  'medicines',
  'rent',
  'deposit',
  'furniture from ikea',
  'amazon order',
  'phone bill',
  'gas cylinder',
  'water can',
  'vegetables',
  'fruits',
  'chicken',
  'mutton',
  'beer',
  'wine',
  'whisky',
  'snacks',
  'ice cream',
  'coffee at starbucks',
  'pizza hut',
  'dominos',
  'kfc',
  'mcdonalds',
  'subway',
  'parotta and beef fry',
  'onam sadya',
  'toddy shop',
  'temple donation',
  'school fees',
  'tuition',
  'cricket kit',
  'football boots',
  'barbie and lego',
  'cinema',
  'bowling',
  'karaoke',
  'manicure',
  'spa day',
  'car wash',
  'service charge',
  'cover charge',
  'tips',
  'sunday roast',
  'bottle shop',
  'servo',
  'maccas',
  'arvo tea',
];

/** Sentences with no person in them: whatever the group, nobody may be picked. */
function falsePeople(): { count: number; picks: string[] } {
  const picks: string[] = [];
  let count = 0;
  const frames = [
    '{s} 500',
    'paid 500 for {s}',
    'split 600 for {s} equally',
    '{s} 300 split with everyone',
  ];
  SPENDS.forEach((spend, i) => {
    frames.forEach((frame, j) => {
      const seed = 100_000 + i * 10 + j;
      const rand = mulberry32(seed);
      const target = NAMES[Math.floor(rand() * NAMES.length)]?.name ?? 'Ravi';
      const members = buildGroup(target, seed);
      const said = frame.replace('{s}', spend);
      const intent = parseVoiceIntent(said, { members, now: NOW });
      const parties: VoiceParty[] = [intent.payer, ...(intent.participants ?? [])];
      count += 1;
      for (const party of parties)
        if (party.status === 'resolved' || (party.status === 'me' && intent.payer.explicit))
          picks.push(`"${said}" -> ${party.name} in {${members.map((m) => m.name).join(', ')}}`);
    });
  });
  return { count, picks };
}

describe('spoken-name bench: sentences that name nobody', BENCH, () => {
  const { count, picks } = falsePeople();
  it('picks nobody', () => {
    console.log(`no-name sentences n=${count}  people wrongly picked ${picks.length}`);
    if (picks.length > 0) console.log(picks.join('\n'));
    expect(picks).toEqual([]);
  });
});

/**
 * Everyday phrases that sound like somebody in the group — "bought a new phone"
 * with an Anu, "rainy day taxi" with a Renny, "pooja items" with a Pooja, a shop
 * named after a person ("Anand Bhavan", "Peter England"). Each is said in four
 * frames, the last naming a real payer who must still be found ("rainy day taxi,
 * paid by Ravi" is Ravi and only Ravi). The bait people are always in the group.
 */
const BAITS: readonly (readonly [string, readonly string[]])[] = [
  ['bought a new phone', ['Anu']],
  ['rainy day taxi', ['Renny']],
  ['a run club fees', ['Arun']],
  ['iron box', ['Arun']],
  ['garlic bread', ['Karthik']],
  ['gothic cafe', ['Karthik']],
  ['cardiac checkup', ['Karthik']],
  ['shiny new shoes', ['Shiny']],
  ['sunny side breakfast', ['Sunil', 'Shiny']],
  ['deep fried snacks', ['Deepa', 'Dileep']],
  ['deep cleaning', ['Deepak', 'Deepa']],
  ['tea and biscuits', ['Teja']],
  ['rice and dal', ['Riya', 'Ravi']],
  ['amul butter', ['Amal', 'Amit']],
  ['a mat for yoga', ['Amit', 'Matthew']],
  ['a mall trip', ['Amal']],
  ['alley parking', ['Ali']],
  ['bindi and bangles', ['Bindu']],
  ['sindhi curry', ['Sindhu']],
  ['jeera rice', ['Jeeva']],
  ['radio repair', ['Radha']],
  ['petrol for the bike', ['Biju']],
  ['sim card recharge', ['Simran']],
  ['manure for the garden', ['Manju', 'Manoj']],
  ['honey and lemon', ['Hannah', 'Huda']],
  ['a new charger', ['Anu', 'Anoop']],
  ['a nice dinner', ['Aneesh']],
  ['mega mart', ['Megha']],
  ['sweets for diwali', ['Swati', 'Shweta']],
  ['nick knacks', ['Nikhil']],
  ['job interview travel', ['Jobin']],
  ['ream of paper', ['Reem']],
  ['sultana raisins', ['Sultan']],
  ['salmon fillet', ['Salma']],
  ['tariff charges', ['Tariq']],
  ['mansion rent', ['Mansour']],
  ['safe deposit locker', ['Saif']],
  ['jasmine tea', ['Yasmin']],
  ['jackfruit chips', ['Jack']],
  ['remy martin', ['Renny']],
  ['pooja items', ['Pooja']],
  ['prasadam for the temple', ['Prasanna']],
  ['usha fan repair', ['Usha']],
  ['anand bhavan meals', ['Anand']],
  ['saravana bhavan lunch', ['Saravanan']],
  ['murugan idli shop', ['Murugan']],
  ['peter england shirt', ['Peter']],
  ['brooke bond tea', ['Brooke']],
  ['marks and spencer', ['Mark']],
  ['max fashion', ['Max']],
  ['lakshmi vilas sweets', ['Lakshmi']],
  ['hamper basket', ['Hamad']],
  ['kebab platter', ['Kabir']],
  ['dosa batter', ['Divya']],
  ['vada pav', ['Vidya']],
];

/** Frames for a bait: the last names a real payer, `{x}`, who must be found. */
const BAIT_FRAMES = [
  '{p} 500',
  'paid 500 for {p}',
  '{p} 300 split with everyone',
  '{p}, paid by {x}',
];

interface BaitResult {
  count: number;
  /** A person who was never said, filled in. */
  autoInserted: string[];
  /** A person who was never said, offered as "Did you mean" or "A or B". */
  askedInserted: string[];
  /** The real payer in the last frame, not filled in. */
  missedPayer: string[];
}

function baitSentences(
  extra: (members: VoiceNameCandidate[]) => Partial<VoiceIntentContext> = () => ({}),
): BaitResult {
  const result: BaitResult = { count: 0, autoInserted: [], askedInserted: [], missedPayer: [] };
  BAITS.forEach(([phrase, baits], i) => {
    BAIT_FRAMES.forEach((frame, j) => {
      const rand = mulberry32(200_000 + i * 10 + j);
      const names = [...baits];
      const size = names.length + 2 + Math.floor(rand() * 4);
      while (names.length < size) {
        const name = NAMES[Math.floor(rand() * NAMES.length)]?.name ?? 'Ravi';
        const looksLikeBait = baits.some((bait) => bait[0] === name[0]);
        if (!names.includes(name) && !looksLikeBait) names.push(name);
      }
      // The speaker is the last; the payer of the last frame the one before.
      const members: VoiceNameCandidate[] = names.map((name, k) => ({
        id: `m${k}`,
        name,
        ...(k === names.length - 1 ? { isMe: true } : {}),
      }));
      const payer = members[members.length - 2] as VoiceNameCandidate;
      const said = frame.replace('{p}', phrase).replace('{x}', payer.name.toLowerCase());
      const intent = parseVoiceIntent(said, { members, now: NOW, ...extra(members) });
      const parties: VoiceParty[] = [intent.payer, ...(intent.participants ?? [])];
      const allowed = frame.includes('{x}') ? payer.id : null;
      result.count += 1;
      const where = `"${said}" in {${names.join(', ')}}`;
      for (const party of parties) {
        const status = party.status as string;
        if (status === 'resolved' && party.memberId !== allowed)
          result.autoInserted.push(`${where} -> ${party.name}`);
        else if (party.status === 'me' && intent.payer.explicit)
          result.autoInserted.push(`${where} -> me`);
        else if (
          (status === 'suggested' || status === 'ambiguous') &&
          (party.candidates ?? []).some((c) => c.id !== allowed)
        )
          result.askedInserted.push(
            `${where} -> ${status} ${party.candidates?.map((c) => c.name).join('/')}`,
          );
      }
      if (allowed && !parties.some((party) => party.memberId === allowed))
        result.missedPayer.push(where);
    });
  });
  return result;
}

describe('spoken-name bench: everyday words that sound like somebody', BENCH, () => {
  const result = baitSentences();
  it('fills in nobody who was not said', () => {
    console.log(
      [
        `bait sentences n=${result.count}`,
        `false insertions: auto ${pct(result.autoInserted.length, result.count)} (${result.autoInserted.length})`,
        `asked ${pct(result.askedInserted.length, result.count)} (${result.askedInserted.length})`,
        `real payer missed ${result.missedPayer.length}`,
      ].join('  '),
    );
    if (VERBOSE)
      console.log(
        [...result.autoInserted, ...result.askedInserted, ...result.missedPayer].join('\n'),
      );
    expect(result.autoInserted).toEqual([]);
    expect(result.askedInserted).toEqual([]);
    expect(result.missedPayer).toEqual([]);
  });
});
