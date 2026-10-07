/**
 * Matching a spoken name against the people or groups it might mean.
 *
 * Speech-to-text spells names the way they sound ("renny", "rainy" and "reni"
 * for Renny), so an exact comparison is not enough — and a guess that quietly
 * picks the wrong person is worse than a question. Every result therefore says
 * how sure it is: resolved (with a `fuzzy` flag when the spelling only sounds
 * alike), ambiguous (several fit equally — the caller asks), or unresolved.
 */

export interface VoiceNameCandidate {
  readonly id: string;
  readonly name: string;
  /** This candidate is the person speaking ("Madan" said by Madan means "me"). */
  readonly isMe?: boolean;
}

export type NameResolution =
  | { readonly status: 'me' }
  | {
      readonly status: 'resolved';
      readonly id: string;
      readonly name: string;
      /** Matched by sound or near-spelling, not letter for letter. */
      readonly fuzzy: boolean;
    }
  | { readonly status: 'ambiguous'; readonly candidates: readonly VoiceNameCandidate[] }
  | { readonly status: 'unresolved' };

/** Words that mean "the person speaking" — English, Hinglish and Hindi-in-Latin. */
const ME_WORDS = new Set([
  'me',
  'i',
  'myself',
  'mine',
  'my',
  'main',
  'mai',
  'mujhe',
  'mujhko',
  'mera',
  'mere',
  'meri',
  'we',
  'us',
  'ourselves',
  'hum',
  'humne',
]);

export function isMeWord(word: string): boolean {
  return ME_WORDS.has(word.toLowerCase());
}

/* ───────────────────────────── spelling ───────────────────────────── */

const DEVANAGARI_VOWELS: Record<string, string> = {
  अ: 'a',
  आ: 'aa',
  इ: 'i',
  ई: 'ee',
  उ: 'u',
  ऊ: 'oo',
  ऋ: 'ri',
  ए: 'e',
  ऐ: 'ai',
  ओ: 'o',
  औ: 'au',
  ऑ: 'o',
};
const DEVANAGARI_SIGNS: Record<string, string> = {
  'ा': 'aa',
  'ि': 'i',
  'ी': 'ee',
  'ु': 'u',
  'ू': 'oo',
  'ृ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
  'ॉ': 'o',
};
const DEVANAGARI_CONSONANTS: Record<string, string> = {
  क: 'k',
  ख: 'kh',
  ग: 'g',
  घ: 'gh',
  ङ: 'n',
  च: 'ch',
  छ: 'chh',
  ज: 'j',
  झ: 'jh',
  ञ: 'n',
  ट: 't',
  ठ: 'th',
  ड: 'd',
  ढ: 'dh',
  ण: 'n',
  त: 't',
  थ: 'th',
  द: 'd',
  ध: 'dh',
  न: 'n',
  प: 'p',
  फ: 'ph',
  ब: 'b',
  भ: 'bh',
  म: 'm',
  य: 'y',
  र: 'r',
  ल: 'l',
  ळ: 'l',
  व: 'v',
  श: 'sh',
  ष: 'sh',
  स: 's',
  ह: 'h',
  क़: 'q',
  ख़: 'kh',
  ग़: 'gh',
  ज़: 'z',
  ड़: 'r',
  ढ़: 'rh',
  फ़: 'f',
};
const ARABIC_LETTERS: Record<string, string> = {
  ا: 'a',
  أ: 'a',
  إ: 'i',
  آ: 'aa',
  ب: 'b',
  ت: 't',
  ث: 'th',
  ج: 'j',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ذ: 'dh',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'd',
  ط: 't',
  ظ: 'z',
  ع: '',
  غ: 'gh',
  ف: 'f',
  ق: 'q',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  ة: 'a',
  و: 'w',
  ي: 'y',
  ى: 'a',
  ء: '',
  ئ: 'y',
  ؤ: 'w',
};

/**
 * Hindi and Arabic script spelled out in Latin letters, roughly as an Indian or
 * Gulf English speaker would type it. A multilingual recogniser hears a name
 * inside an English sentence and writes it in its own script ("split with
 * श्रेया and me"); this turns that back into "shreya" so it can be matched.
 * The inherent "a" after the last consonant is dropped, as in speech (राघव →
 * "raghav").
 */
export function romanise(text: string): string {
  if (!/[ऀ-ॿ؀-ۿ]/u.test(text)) return text;
  const chars = [...text.normalize('NFC')];
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? '';
    let next = chars[i + 1] ?? '';
    let consonant = DEVANAGARI_CONSONANTS[ch];
    if (consonant !== undefined && next === '़') {
      consonant = DEVANAGARI_CONSONANTS[ch + next] ?? consonant;
      i += 1;
      next = chars[i + 1] ?? '';
    }
    if (consonant !== undefined) {
      out += consonant;
      if (next === '्') i += 1;
      else if (DEVANAGARI_SIGNS[next] === undefined && /[ऀ-ॿ]/u.test(next)) out += 'a';
      continue;
    }
    if (DEVANAGARI_VOWELS[ch] !== undefined) out += DEVANAGARI_VOWELS[ch];
    else if (DEVANAGARI_SIGNS[ch] !== undefined) out += DEVANAGARI_SIGNS[ch];
    else if (ch === 'ं' || ch === 'ँ') out += 'n';
    else if (ch === 'ः') out += 'h';
    else if (ARABIC_LETTERS[ch] !== undefined) out += ARABIC_LETTERS[ch];
    else if (/[ऀ-ॿ؀-ۿ]/u.test(ch)) continue;
    else out += ch;
  }
  // A long ā at the end of a name is written with one "a": श्रेया is "shreya".
  return out.replace(/aa(?=[^a-z]|$)/g, 'a');
}

/** Letters only, lowercased, diacritics folded, Hindi and Arabic script spelled in Latin. */
export function nameToken(word: string): string {
  return romanise(word)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function nameTokens(text: string): string[] {
  return text.split(/\s+/).map(nameToken).filter(Boolean);
}

/* ───────────────────────────── sound keys ───────────────────────────── */

/**
 * How a name sounds, as letters: two spellings with the same sound key are said
 * the same way, so a recogniser could write either — "Priya"/"Pria",
 * "Sumit"/"Sumeet", "Arun"/"Arrun", "Renny"/"rainy", "Hari"/"Harry",
 * "Shwetha"/"Swetha".
 *
 * It folds the spellings Indian and Gulf English pronounce alike: aspirated and
 * retroflex letters (th, dh, bh, kh, gh as t, d, b, k, g), sh/s, v/w, ph/f, q/k,
 * z/j, doubled letters and a final "h". Vowels keep their quality in four
 * classes — a; e (and "ai"/"ay"/"ei"/"ey", the long e an Indian-English ear
 * hears in "rainy"); i (ee, ea, ie, y); u (o, oo, ou, au) — so "Renny" and
 * "Rani" stay apart.
 */
export function soundKey(word: string): string {
  return nameToken(word)
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 'j')
    .replace(/ck/g, 'k')
    .replace(/ch/g, 'C')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/(?<=[^aeiou])h/g, '')
    .replace(/h$/g, '')
    .replace(/(?<=.)(ai|ay|ei|ey)/g, 'e')
    .replace(/ee|ea|ie|(?<=.)y/g, 'i')
    .replace(/oo|ou|au|aw|o/g, 'u')
    .replace(/(.)\1+/g, '$1')
    .replace(/C/g, 'ch');
}

/**
 * A coarser sound key: {@link soundKey} with every vowel after the first read as
 * one, the way unstressed vowels blur in speech — "Mohammed"/"Muhammad",
 * "Senthil"/"sentil", "Revathi"/"ravathi" all share one.
 */
export function phoneticKey(word: string): string {
  return soundKey(word)
    .replace(/(?<=.)[aeiu]/g, 'a')
    .replace(/(.)\1+/g, '$1');
}

/**
 * A coarser key: the consonants alone, in the classes a recogniser swaps —
 * voiced and voiceless pairs (b/p, d/t, g/k, j/ch), s/sh/z, v/w/f — with the
 * vowels gone except a leading one. "Senthil" and "sintel", "Kavya" and
 * "kavia", "Chaitra" and "jetra" all share one.
 */
export function consonantKey(word: string): string {
  const token = nameToken(word);
  const lead = /^[aeiou]/.test(token) ? 'A' : '';
  const body = token
    .replace(/ph/g, 'f')
    .replace(/ck|q|x/g, 'k')
    .replace(/ch/g, 'j')
    .replace(/sh|z/g, 's')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/[bp]/g, 'B')
    .replace(/[dt]/g, 'T')
    .replace(/[gk]/g, 'K')
    .replace(/j/g, 'J')
    .replace(/[vwf]/g, 'V')
    .replace(/[aeiouyh]/g, '')
    .replace(/(.)\1+/g, '$1')
    .toUpperCase();
  return lead + body;
}

/** The consonants alone, repeats folded: "renny" and "rainy" are both "rny". */
function skeleton(word: string): string {
  return word.replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}

/** Edit distance of at most one (insert, delete, substitute, or swap). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/** Jaro-Winkler similarity, 0 (nothing alike) to 1 (identical). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit: boolean[] = [];
  const bHit: boolean[] = [];
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const from = Math.max(0, i - window);
    const to = Math.min(b.length - 1, i + window);
    for (let j = from; j <= to; j += 1) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = true;
      bHit[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] !== undefined && a[prefix] === b[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function namesSoundAlike(heard: string, name: string): boolean {
  if (heard === name) return true;
  if (Math.min(heard.length, name.length) < 4) return false;
  if (Math.min(heard.length, name.length) >= 5 && withinOneEdit(heard, name)) return true;
  const key = phoneticKey(heard);
  return key.length >= 3 && key === phoneticKey(name);
}

/* ───────────────────────────── scoring ───────────────────────────── */

/** 3 exact, 2 sounds alike, 1 same consonant skeleton, 0 unrelated. Used for group names. */
function tokenTier(heard: string, name: string): 0 | 1 | 2 | 3 {
  if (heard === name) return heard.length >= 2 ? 3 : 0;
  if (heard.length < 3 || name.length < 3) return 0;
  if (namesSoundAlike(heard, name)) return 2;
  const a = skeleton(heard);
  const b = skeleton(name);
  if (a.length >= 3 && a === b && heard[0] === name[0]) return 1;
  return 0;
}

/** Spelled the same. */
const EXACT = 1;
/** Said the same ("Hari" and "Harry"): a different spelling can't tell them apart. */
const SAME_SOUND = 0.95;
/** The most a merely similar spelling can score — always below {@link SAME_SOUND}. */
const NEAR_CAP = 0.9;
/** A short form of the name ("Matt" for Matthew): good, but never ahead of somebody actually called Matt. */
const NICKNAME = 0.78;
/** A guess below this is no guess at all. */
const ACCEPT = 0.6;
/**
 * Close enough to stand in the way: a weaker likeness that can't be picked on
 * its own still stops a slightly better one from being picked over it.
 */
const CONSIDER = 0.45;
/** How far ahead of the next person a near match must be to be picked. */
const MARGIN = 0.18;
/**
 * How far ahead an exact match must be. Exact (1) against
 * same-sound (0.95) falls inside it — "harry" with both Hari and Harry in the
 * group is a question — and so does a spelling one vowel away: "rajesh" with
 * both Rajesh and Rajeesh asks.
 */
const SURE_MARGIN = 0.19;

/** Short forms people say for the full name in their contacts. */
const NICKNAMES: Record<string, readonly string[]> = {
  abdul: ['abdullah', 'abdulla'],
  abdu: ['abdullah'],
  mo: ['mohammed', 'mohammad', 'muhammad', 'mohamed'],
  moh: ['mohammed', 'mohammad', 'muhammad', 'mohamed'],
  hamoudi: ['mohammed', 'hamad', 'hamdan'],
  chris: ['christopher', 'christina', 'christine'],
  matt: ['matthew'],
  mike: ['michael'],
  mick: ['michael'],
  dan: ['daniel'],
  danny: ['daniel'],
  tom: ['thomas'],
  tommy: ['thomas'],
  ben: ['benjamin'],
  sam: ['samuel', 'samantha'],
  alex: ['alexander', 'alexandra'],
  kate: ['katherine', 'catherine', 'kathryn'],
  katie: ['katherine', 'catherine'],
  liz: ['elizabeth'],
  beth: ['elizabeth', 'bethany'],
  bob: ['robert'],
  rob: ['robert'],
  bill: ['william'],
  will: ['william'],
  dave: ['david'],
  steve: ['stephen', 'steven'],
  andy: ['andrew'],
  drew: ['andrew'],
  josh: ['joshua'],
  jake: ['jacob'],
  jim: ['james'],
  jimmy: ['james'],
  jamie: ['james'],
  jack: ['john', 'jackson'],
  johnny: ['john'],
  tony: ['anthony'],
  nick: ['nicholas'],
  pete: ['peter'],
  charlie: ['charles', 'charlotte'],
  harry: ['harold', 'henry'],
  lachie: ['lachlan'],
  maddie: ['madeleine', 'madison'],
  abhi: ['abhishek', 'abhinav'],
  raghu: ['raghav', 'raghavendra', 'raghunath'],
  venky: ['venkat', 'venkatesh'],
  balu: ['balaji', 'balakrishnan'],
  siddhu: ['siddharth'],
  sid: ['siddharth'],
  manju: ['manjunath', 'manjula'],
  shiva: ['shivakumar', 'shivaram'],
  sri: ['srinivas', 'sriram'],
  seenu: ['srinivas'],
  chinnu: ['chaitanya'],
};

/** Words a recogniser types for a name it didn't know ("rainy" for Renny): a match through one must sound the same. */
const COMMON_WORDS = new Set([
  'may',
  'man',
  'men',
  'mother',
  'father',
  'brother',
  'sister',
  'mom',
  'mum',
  'dad',
  'son',
  'sun',
  'sunny',
  'rainy',
  'run',
  'value',
  'delete',
  'omit',
  'sweater',
  'capital',
  'garlic',
  'year',
  'years',
  'class',
  'clothes',
  'russia',
  'annually',
  'divider',
  'central',
  'direct',
  'kentucky',
  'bilingual',
  'because',
  'release',
  'player',
  'full',
  'fill',
  'feel',
  'phone',
  'pay',
  'page',
  'paid',
  'repaid',
  'pit',
  'pie',
  'pin',
  'sigh',
  'side',
  'shaggy',
  'mercury',
  'weekly',
  'single',
  'cake',
  'shake',
  'mine',
  'mean',
  'meet',
  'need',
  'knee',
  'neat',
  'nice',
  'night',
  'take',
  'tell',
  'till',
  'time',
  'tea',
  'team',
  'okay',
  'yeah',
  'yes',
  'nah',
  'hello',
  'help',
  'hold',
  'hall',
  'hill',
  'more',
  'most',
  'much',
  'many',
  'money',
  'pound',
  'pounds',
  'dollar',
  'dollars',
  'rupees',
  'cash',
  'card',
  'cost',
  'costs',
  'price',
  'shop',
  'store',
  'snack',
  'snacks',
  'drink',
  'drinks',
  'beer',
  'wine',
  'pizza',
  'cafe',
  'trip',
  'flat',
  'house',
  'home',
  'work',
  'office',
  'party',
  'gift',
  'other',
  'others',
  'another',
  'some',
  'same',
  'said',
  'say',
  'says',
  'see',
  'seen',
  'sell',
  'send',
  'sent',
  'share',
  'shared',
  'there',
  'their',
  'they',
  'them',
  'then',
  'than',
  'these',
  'those',
  'what',
  'which',
  'who',
  'whom',
  'why',
  'how',
  'here',
  'where',
  'your',
  'you',
  'yours',
  'our',
  'ours',
  'his',
  'her',
  'hers',
  'him',
  'she',
  'he',
  'its',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'hundred',
  'thousand',
  'lakh',
  'lakhs',
  'crore',
  'first',
  'second',
  'third',
  'last',
  'next',
  'week',
  'month',
  'morning',
  'evening',
  'tonight',
  'dinner',
  'lunch',
  'breakfast',
  'rent',
  'fuel',
  'petrol',
  'taxi',
  'cab',
  'uber',
  'bus',
  'train',
  'flight',
  'ticket',
  'tickets',
  'movie',
  'hotel',
  'room',
  'food',
  'coffee',
  'water',
  'bill',
  'bills',
  'tip',
  'tax',
  'fee',
  'fees',
  'and',
  'or',
  'but',
  'not',
  'all',
  'any',
  'each',
  'every',
  'both',
  'half',
  'part',
  'rest',
  'only',
  'also',
  'just',
  'well',
  'good',
  'great',
  'right',
  'left',
  'back',
  'even',
  'ever',
  'never',
  'again',
  'over',
  'under',
  'into',
  'onto',
  'with',
  'without',
  'from',
  'for',
  'have',
  'has',
  'had',
  'having',
  'give',
  'gave',
  'given',
  'get',
  'got',
  'make',
  'made',
  'let',
  'put',
  'owe',
  'owes',
  'owed',
  'split',
  'equal',
  'equally',
]);

/** Respectful or familial words said around a name: "Ravi ji", "Murugan anna", "Renny chechi". */
const HONORIFICS = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'ji',
  'jee',
  'bhai',
  'bhaiya',
  'bhaiyya',
  'didi',
  'di',
  'dada',
  'da',
  'anna',
  'akka',
  'thambi',
  'chechi',
  'chetta',
  'chettan',
  'chettai',
  'machan',
  'kutty',
  'saar',
  'sir',
  'madam',
  'maam',
  'mam',
  'mr',
  'mrs',
  'ms',
  'miss',
  'mister',
  'dr',
  'doctor',
  'uncle',
  'aunty',
  'auntie',
  'group',
]);

/** A suffix said onto the name itself: "raviji", "muruganna", "rennychechi". */
const GLUED_HONORIFIC = /(ji|jee|bhai|anna|akka|chechi|chettan|chetta|kutty|garu|avare)$/;

/** Words dropped from a group's name before matching. */
const FILLER = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'ji',
  'bhai',
  'bhaiya',
  'didi',
  'sir',
  'group',
]);

/** Words that join two names: what is either side of them is never one name. */
const JOINERS = new Set(['and', 'aur', 'or', 'plus', 'with']);

/** Honorifics out, unless the honorific is all there is ("Anna" is a name too). */
function withoutHonorifics(tokens: readonly string[]): string[] {
  const kept = tokens.filter((token) => !HONORIFICS.has(token));
  return kept.length > 0 ? kept : [...tokens];
}

/** Every reading of a heard word worth trying: itself, and without a glued-on honorific. */
function heardForms(token: string): string[] {
  const forms = [token];
  const bare = token.replace(GLUED_HONORIFIC, '');
  if (bare !== token && bare.length >= 3) forms.push(bare);
  return forms;
}

/**
 * How alike a heard word and one word of a name are, from 0 to 1.
 *
 * Exact is 1, the same sound 0.95; anything else is a blend of Jaro-Winkler on
 * the sound keys, on the consonant keys and on the letters, capped below 0.9 so
 * a near spelling never ties an exact one. Words the recogniser types for a
 * name it didn't know ("value", "sweater") count only when they sound the same.
 */
export function nameSimilarity(heard: string, name: string): number {
  if (heard === name) return heard.length >= 2 ? EXACT : 0;
  if (heard.length < 2 || name.length < 2) return 0;
  const heardSound = soundKey(heard);
  if (
    heardSound === soundKey(name) &&
    heardSound.length >= 2 &&
    Math.min(heard.length, name.length) >= 3
  )
    return SAME_SOUND;
  if (NICKNAMES[heard]?.includes(name)) return NICKNAME;
  if (heard.length < 4 || name.length < 3 || heardSound.length < 3) return 0;
  if (COMMON_WORDS.has(heard)) return 0;
  let score = soundAlike(heardSound, soundKey(name));
  // Recognisers rarely get the first sound wrong; when they do, it is weaker evidence.
  if (consonantKey(heard)[0] !== consonantKey(name)[0]) score -= 0.1;
  return NEAR_CAP * Math.max(0, Math.min(1, score));
}

const VOWELS = new Set(['a', 'e', 'i', 'u']);
/** Consonants a recogniser swaps for each other: voicing pairs, nasals, liquids. */
const CONSONANT_CLASS: Record<string, string> = {
  b: 'p',
  p: 'p',
  d: 't',
  t: 't',
  g: 'k',
  k: 'k',
  j: 'j',
  C: 'j',
  s: 's',
  v: 'f',
  f: 'f',
  m: 'n',
  n: 'n',
  l: 'l',
  r: 'l',
};

/**
 * Sounds an English recogniser confuses across classes: a soft g for j
 * ("Ginsey" for Jincy), j for y, v for b (Bengali "Sourav"/"Saurabh"), s for ch.
 */
const NEAR_PAIRS = new Set(['gj', 'jy', 'vb', 'fb', 'sC', 'jC', 'kC', 'tC']);

function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  const vowelA = VOWELS.has(a);
  const vowelB = VOWELS.has(b);
  if (vowelA && vowelB) return 0.35;
  if (vowelA || vowelB) return 1;
  const classA = CONSONANT_CLASS[a];
  if (classA !== undefined && classA === CONSONANT_CLASS[b]) return 0.45;
  return NEAR_PAIRS.has(a + b) || NEAR_PAIRS.has(b + a) ? 0.6 : 1;
}

function gapCost(c: string): number {
  if (VOWELS.has(c)) return 0.45;
  return c === 'h' || c === 'y' ? 0.35 : 1;
}

/**
 * How alike two sound keys are, 0 to 1: an edit distance where the edits a
 * recogniser makes are cheap — one vowel for another, b for p, d for t, m for
 * n, l for r, a dropped vowel or h — and anything else costs a full letter,
 * scaled by the longer key.
 */
function soundAlike(a: string, b: string): number {
  const left = [...a.replace(/ch/g, 'C')];
  const right = [...b.replace(/ch/g, 'C')];
  let previous = [0];
  for (const c of right) previous.push((previous[previous.length - 1] ?? 0) + gapCost(c));
  for (const x of left) {
    const current = [(previous[0] ?? 0) + gapCost(x)];
    right.forEach((y, j) => {
      current.push(
        Math.min(
          (previous[j + 1] ?? 0) + gapCost(x),
          (current[j] ?? 0) + gapCost(y),
          (previous[j] ?? 0) + substitutionCost(x, y),
        ),
      );
    });
    previous = current;
  }
  const size = Math.max(
    left.reduce((sum, c) => sum + gapCost(c), 0),
    right.reduce((sum, c) => sum + gapCost(c), 0),
  );
  return size === 0 ? 0 : 1 - (previous[right.length] ?? 0) / size;
}

interface Scored<T> {
  readonly item: T;
  readonly score: number;
  readonly worst: number;
}

/** The best similarity of a heard word to any word of a name, any heard form. */
function bestAgainst(heard: string, nameWords: readonly string[]): number {
  let best = 0;
  for (const form of heardForms(heard))
    nameWords.forEach((word, i) => {
      const score = nameSimilarity(form, word);
      // A surname counts only when it is said, not when something like it is:
      // "reddy paid" is Mohammed Reddy, "radi paid" is not.
      best = Math.max(best, i === 0 || score >= SAME_SOUND ? score : 0);
    });
  return best;
}

/**
 * How well the heard words fit one candidate's name, 0 to about 1.
 *
 * Word by word, every heard word must find a partner (for one or two words) and
 * the score is their mean, nudged up for each extra word matched, so a full
 * name outranks a first name. The heard words run together are tried too, since
 * a recogniser splits a name it doesn't know into words it does: "sun eel" is
 * Sunil, "nick hill" is Nikhil, "tamil selvi" is Tamilselvi.
 */
function fitName(heard: readonly string[], nameWords: readonly string[], canJoin: boolean): number {
  let total = 0;
  let matched = 0;
  for (const token of heard) {
    const best = bestAgainst(token, nameWords);
    if (best >= CONSIDER) {
      matched += 1;
      total += best;
    }
  }
  let wordwise = 0;
  if (matched > 0 && (heard.length > 2 || matched === heard.length))
    wordwise = total / matched + 0.02 * (matched - 1) - 0.05 * (heard.length - matched);
  let joined = 0;
  if (canJoin && heard.length >= 2) {
    const together = heard.join('');
    const whole = nameWords.join('');
    // Only against a word of about the same length: "madanmeera" is two people, not Madan.
    const comparable = [...nameWords, whole].filter(
      (word) => Math.abs(word.length - together.length) <= Math.max(2, word.length / 4),
    );
    // Run-together words are never as sure as a name said whole.
    joined = Math.min(SAME_SOUND, bestAgainst(together, comparable));
  }
  return Math.max(wordwise, joined);
}

/** Word-by-word tiers for group names. */
function scoreAgainst(
  heard: readonly string[],
  candidateTokens: readonly string[],
  requireAll: boolean,
): { score: number; worst: number } | null {
  let score = 0;
  let worst = 3;
  let matched = 0;
  for (const token of heard) {
    let best = 0;
    for (const other of candidateTokens) best = Math.max(best, tokenTier(token, other));
    if (best > 0) {
      matched += 1;
      score += best;
      worst = Math.min(worst, best);
    }
  }
  if (matched === 0) return null;
  if (requireAll && matched < heard.length) return null;
  return { score, worst };
}

/**
 * Who a spoken name means.
 *
 * "me", "I", "myself" and the Hinglish "main"/"mujhe" are the speaker; a name
 * that matches the speaker's own member row is also the speaker. Anything else
 * is scored against every candidate; the best wins only when it is good enough
 * and clearly ahead of the next. Two people who fit about as well — "harry"
 * with both Hari and Harry in the group, "rajesh" with Rajesh and Rajeesh — is
 * `ambiguous`: the caller asks, it never tosses a coin.
 */
export function resolveSpokenName(
  heard: string,
  candidates: readonly VoiceNameCandidate[],
): NameResolution {
  const said = nameTokens(heard);
  const tokens = withoutHonorifics(said);
  // "sun eel" and "a run" may be Sunil and Arun; "matt and you" is two people, never "mattyou".
  const canJoin = said.length >= 2 && said.length <= 3 && !said.some((word) => JOINERS.has(word));
  if (tokens.length === 0) return { status: 'unresolved' };
  if (tokens.length === 1 && isMeWord(tokens[0] ?? '')) return { status: 'me' };

  const scored: { item: VoiceNameCandidate; score: number }[] = [];
  for (const candidate of candidates) {
    const words = withoutHonorifics(nameTokens(candidate.name));
    if (words.length === 0) continue;
    const score = Math.max(fitName(tokens, words, false), canJoin ? fitName(said, words, true) : 0);
    if (score >= CONSIDER) scored.push({ item: candidate, score });
  }
  if (scored.length === 0) return { status: 'unresolved' };
  // Best first; between equals, the closer spelling of the first name leads the
  // question the caller asks (Jaro-Winkler only orders — it never picks).
  const spelled = tokens.join('');
  const lead = (entry: { item: VoiceNameCandidate }): number =>
    jaroWinkler(spelled, nameTokens(entry.item.name)[0] ?? '');
  scored.sort((a, b) => b.score - a.score || lead(b) - lead(a));

  const top = scored[0];
  if (!top || top.score < ACCEPT) return { status: 'unresolved' };
  const margin = top.score >= EXACT ? SURE_MARGIN : MARGIN;
  const close = scored.filter((entry) => top.score - entry.score < margin);
  if (close.length > 1) {
    // The speaker and one other: still a question — never quietly "me".
    return { status: 'ambiguous', candidates: close.map((entry) => entry.item) };
  }
  const { item, score } = top;
  if (item.isMe) return { status: 'me' };
  return { status: 'resolved', id: item.id, name: item.name, fuzzy: score < EXACT };
}

export interface VoiceGroupCandidate {
  readonly id: string;
  readonly name: string | null;
}

export type GroupResolution =
  | {
      readonly status: 'resolved';
      readonly id: string;
      readonly name: string;
      /** The spoken words are the whole of the name, spelled right. */
      readonly exact: boolean;
    }
  | { readonly status: 'ambiguous'; readonly candidates: readonly VoiceGroupCandidate[] }
  | { readonly status: 'unresolved' };

/**
 * Which group a spoken name means. "goa" finds "Goa Trip 2026" when nothing
 * else says goa; with "Goa Trip" and "Goa Flat" both present it is ambiguous
 * and the caller asks, unless more of the name was said ("goa trip").
 */
export function resolveSpokenGroup(
  heard: string,
  groups: readonly VoiceGroupCandidate[],
): GroupResolution {
  const tokens = nameTokens(heard).filter((token) => !FILLER.has(token));
  if (tokens.length === 0) return { status: 'unresolved' };

  const scored: (Scored<VoiceGroupCandidate> & { covered: boolean })[] = [];
  for (const group of groups) {
    if (!group.name) continue;
    const groupTokens = nameTokens(group.name).filter((token) => !FILLER.has(token));
    if (groupTokens.length === 0) continue;
    const result = scoreAgainst(tokens, groupTokens, true);
    if (!result) continue;
    // Naming the whole group beats naming part of it; leftover words in the
    // group's name cost a little, so "goa trip" prefers "Goa Trip" to
    // "Goa Trip Day 2".
    const coveredCount = groupTokens.filter((groupToken) =>
      tokens.some((token) => tokenTier(token, groupToken) > 0),
    ).length;
    const covered = coveredCount === groupTokens.length;
    scored.push({
      item: group,
      score: result.score * 10 + (covered ? 5 : 0) - (groupTokens.length - coveredCount),
      worst: result.worst,
      covered,
    });
  }
  if (scored.length === 0) return { status: 'unresolved' };

  const top = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === top);
  if (best.length > 1) return { status: 'ambiguous', candidates: best.map((entry) => entry.item) };
  const winner = best[0];
  if (!winner) return { status: 'unresolved' };
  return {
    status: 'resolved',
    id: winner.item.id,
    name: winner.item.name ?? '',
    exact:
      winner.covered &&
      winner.worst === 3 &&
      tokens.length === nameTokens(winner.item.name ?? '').filter((t) => !FILLER.has(t)).length,
  };
}
