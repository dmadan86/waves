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
 * the whole sentence through `parseVoiceIntent`. A case is:
 *
 * - correct: the target was found;
 * - wrong person: somebody else was picked (the outcome that costs money);
 * - unresolved: nobody was picked, or the parser asked (ambiguous).
 *
 * Deterministic: no randomness beyond a seeded generator, no network.
 */

import { describe, expect, it } from 'vitest';

import { parseVoiceIntent, type VoiceParty } from '../src/voice/intent';
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

type Outcome = 'correct' | 'wrong' | 'unresolved';

function judge(transcript: string, carrier: number, members: VoiceNameCandidate[]): Outcome {
  const intent = parseVoiceIntent(transcript, {
    members,
    now: new Date('2026-10-01T12:00:00Z'),
  });
  const parties: VoiceParty[] = [intent.payer, ...(intent.participants ?? [])];
  const target = members[0]?.id;
  // "me" heard where the name was ("we paid 500" for Vijay) is a recogniser
  // loss, not a wrong guess; the speaker matched by sound is a wrong guess.
  const meWords = transcript
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word && isMeWord(word)).length;
  const spokenMe = carrier === 1 ? meWords > 1 : meWords > 0;
  let correct = false;
  let wrong = false;
  for (const party of parties) {
    if (party.status === 'resolved') {
      if (party.memberId === target) correct = true;
      else wrong = true;
    }
  }
  const payerIsMeByName = intent.payer.status === 'me' && intent.payer.explicit && !spokenMe;
  const extraMe =
    !spokenMe &&
    carrier !== 1 &&
    (intent.participants ?? []).some((party) => party.status === 'me');
  if (payerIsMeByName || extraMe) wrong = true;
  if (wrong) return 'wrong';
  return correct ? 'correct' : 'unresolved';
}

interface Tally {
  correct: number;
  wrong: number;
  unresolved: number;
}

function run(): { byEngine: Map<string, Tally>; total: Tally; wrongCases: string[] } {
  const byEngine = new Map<string, Tally>();
  const total: Tally = { correct: 0, wrong: 0, unresolved: 0 };
  const wrongCases: string[] = [];
  HEARD.cases.forEach(([name, voice, carrier, engine, transcript], index) => {
    const members = buildGroup(name, index + 1);
    const outcome = judge(transcript, carrier, members);
    const engineName = HEARD.engines[engine] ?? String(engine);
    const tally = byEngine.get(engineName) ?? { correct: 0, wrong: 0, unresolved: 0 };
    tally[outcome] += 1;
    total[outcome] += 1;
    byEngine.set(engineName, tally);
    if (outcome === 'wrong')
      wrongCases.push(
        `${name} [${voice}, ${engineName}] "${transcript}" in {${members.map((m) => m.name).join(', ')}}`,
      );
  });
  return { byEngine, total, wrongCases };
}

/**
 * Ratchets: raise the floor and lower the ceiling as the matcher improves.
 * Most of what is left wrong is the recogniser writing another member's real
 * name ("rakesh" for Rajeesh with a Rakesh in the group), which no matcher can
 * undo; most of what is left unresolved has no trace of the name left in it.
 */
const WRONG_CEILING = 0.001;
const CORRECT_FLOOR = 0.7;

const pct = (part: number, whole: number): string => `${((100 * part) / whole).toFixed(2)}%`;

describe('spoken-name bench (real recogniser transcripts)', () => {
  const { byEngine, total, wrongCases } = run();
  const count = total.correct + total.wrong + total.unresolved;

  it('reports correct / wrong-person / unresolved by engine', () => {
    const lines = [...byEngine].map(
      ([engine, t]) =>
        `${engine.padEnd(24)} n=${String(t.correct + t.wrong + t.unresolved).padStart(5)}  correct ${pct(t.correct, t.correct + t.wrong + t.unresolved)}  wrong ${pct(t.wrong, t.correct + t.wrong + t.unresolved)}  unresolved ${pct(t.unresolved, t.correct + t.wrong + t.unresolved)}`,
    );
    lines.push(
      `${'all'.padEnd(24)} n=${String(count).padStart(5)}  correct ${pct(total.correct, count)}  wrong ${pct(total.wrong, count)}  unresolved ${pct(total.unresolved, count)}`,
    );
    if (VERBOSE) lines.push(...wrongCases);
    console.log(lines.join('\n'));
    expect(count).toBe(HEARD.cases.length);
  });

  it('picks the wrong person almost never', () => {
    expect(total.wrong / count).toBeLessThanOrEqual(WRONG_CEILING);
  });

  it('finds the person in most cases', () => {
    expect(total.correct / count).toBeGreaterThanOrEqual(CORRECT_FLOOR);
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
      const intent = parseVoiceIntent(said, { members, now: new Date('2026-10-01T12:00:00Z') });
      const parties: VoiceParty[] = [intent.payer, ...(intent.participants ?? [])];
      count += 1;
      for (const party of parties)
        if (party.status === 'resolved' || (party.status === 'me' && intent.payer.explicit))
          picks.push(`"${said}" -> ${party.name} in {${members.map((m) => m.name).join(', ')}}`);
    });
  });
  return { count, picks };
}

describe('spoken-name bench: sentences that name nobody', () => {
  const { count, picks } = falsePeople();
  it('picks nobody', () => {
    console.log(`no-name sentences n=${count}  people wrongly picked ${picks.length}`);
    if (picks.length > 0) console.log(picks.join('\n'));
    expect(picks).toEqual([]);
  });
});
