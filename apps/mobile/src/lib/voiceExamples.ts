/**
 * What the "Try saying…" card on Speak an expense suggests, fitted to where the
 * phone is and to the person's own groups.
 *
 * Three sentences, each showing one thing the parser understands: an expense
 * filed to a named group, one split with named people, and one kept "just for
 * me". A sentence only teaches if it sounds like something the reader would
 * say, so the place, the names and the size of the amounts follow the phone's
 * country — a Goa trip and ₹850 of groceries in India, Yosemite and $85 in the
 * US — and the group is one of the reader's real groups whenever they have one,
 * so the first example is a sentence that would actually work as spoken.
 *
 * Pure: the country, the group names and the random source are passed in, so
 * the choice is tested without a device or a clock.
 */

export interface VoiceExampleSet {
  /** A real group's name, or null — then `place` is the trip to name. */
  readonly group: string | null;
  /** A well-known trip destination for the country, used when `group` is null. */
  readonly place: string;
  /** Two first names, common where the phone is. */
  readonly names: readonly [string, string];
  /** Everyday amounts in the local currency's usual size, already formatted. */
  readonly groceries: string;
  readonly dinner: string;
  readonly coffee: string;
}

interface CountryFlavour {
  readonly places: readonly string[];
  readonly names: readonly (readonly [string, string])[];
  /** Groceries, dinner for three, a coffee — in whole units of the currency. */
  readonly amounts: readonly [number, number, number];
}

const FALLBACK: CountryFlavour = {
  places: ['Beach', 'Mountain', 'Weekend'],
  names: [
    ['Alex', 'Sam'],
    ['Maya', 'Leo'],
  ],
  amounts: [60, 90, 5],
};

const FLAVOURS: Readonly<Record<string, CountryFlavour>> = {
  IN: {
    places: ['Goa', 'Manali', 'Ooty', 'Jaipur', 'Coorg', 'Kerala', 'Pondicherry'],
    names: [
      ['Ravi', 'Priya'],
      ['Arjun', 'Meera'],
      ['Karthik', 'Divya'],
      ['Rahul', 'Sneha'],
    ],
    amounts: [850, 1200, 180],
  },
  US: {
    places: ['Yosemite', 'Vegas', 'Miami', 'Yellowstone', 'Nashville', 'Grand Canyon'],
    names: [
      ['Mike', 'Sarah'],
      ['Jake', 'Emily'],
      ['Chris', 'Olivia'],
    ],
    amounts: [85, 120, 6],
  },
  GB: {
    places: ['Cornwall', 'Lake District', 'Edinburgh', 'Brighton', 'Cotswolds'],
    names: [
      ['Oliver', 'Emma'],
      ['Harry', 'Sophie'],
      ['George', 'Amelia'],
    ],
    amounts: [60, 90, 4],
  },
  IE: {
    places: ['Galway', 'Kerry', 'Dingle', 'Killarney'],
    names: [
      ['Sean', 'Aoife'],
      ['Conor', 'Niamh'],
    ],
    amounts: [70, 95, 4],
  },
  AE: {
    places: ['Hatta', 'Oman', 'Ras Al Khaimah', 'Fujairah', 'Abu Dhabi'],
    names: [
      ['Ahmed', 'Fatima'],
      ['Omar', 'Aisha'],
      ['Rashid', 'Mariam'],
    ],
    amounts: [250, 400, 18],
  },
  SA: {
    places: ['AlUla', 'Abha', 'Jeddah', 'Taif'],
    names: [
      ['Faisal', 'Noura'],
      ['Khalid', 'Sara'],
    ],
    amounts: [300, 450, 20],
  },
  QA: {
    places: ['Sealine', 'Zekreet', 'Al Wakrah'],
    names: [
      ['Hamad', 'Maryam'],
      ['Ali', 'Noor'],
    ],
    amounts: [250, 380, 18],
  },
  AU: {
    places: ['Byron Bay', 'Gold Coast', 'Tasmania', 'Great Ocean Road'],
    names: [
      ['Jack', 'Chloe'],
      ['Liam', 'Mia'],
    ],
    amounts: [120, 180, 6],
  },
  NZ: {
    places: ['Queenstown', 'Rotorua', 'Wanaka'],
    names: [
      ['Ethan', 'Isla'],
      ['Nikau', 'Aria'],
    ],
    amounts: [110, 160, 6],
  },
  CA: {
    places: ['Banff', 'Whistler', 'Niagara', 'Tofino'],
    names: [
      ['Liam', 'Olivia'],
      ['Noah', 'Emma'],
    ],
    amounts: [110, 150, 5],
  },
  SG: {
    places: ['Bali', 'Bintan', 'Penang', 'Phuket'],
    names: [
      ['Wei', 'Mei'],
      ['Arjun', 'Siti'],
    ],
    amounts: [90, 140, 6],
  },
  MY: {
    places: ['Langkawi', 'Penang', 'Cameron Highlands'],
    names: [
      ['Amir', 'Nurul'],
      ['Wei', 'Hui'],
    ],
    amounts: [180, 250, 12],
  },
  DE: {
    places: ['Mallorca', 'Bavaria', 'Lake Constance', 'Berlin'],
    names: [
      ['Lukas', 'Anna'],
      ['Felix', 'Lena'],
    ],
    amounts: [70, 90, 4],
  },
  FR: {
    places: ['Nice', 'Provence', 'Chamonix', 'Bordeaux'],
    names: [
      ['Lucas', 'Chloé'],
      ['Hugo', 'Léa'],
    ],
    amounts: [70, 90, 4],
  },
  NL: {
    places: ['Texel', 'Maastricht', 'Zandvoort'],
    names: [
      ['Daan', 'Sanne'],
      ['Lars', 'Emma'],
    ],
    amounts: [65, 90, 4],
  },
  LK: {
    places: ['Ella', 'Galle', 'Kandy', 'Mirissa'],
    names: [
      ['Kasun', 'Nimali'],
      ['Dilan', 'Tharushi'],
    ],
    amounts: [4500, 6000, 900],
  },
};

/**
 * One set of examples. `random` returns [0, 1) — pass a seeded one in tests;
 * the screen draws a new set each time it opens, so the card never reads as a
 * fixed label.
 */
export function voiceExamples(
  country: string | null,
  groupNames: readonly string[],
  random: () => number = Math.random,
): VoiceExampleSet {
  const flavour = (country && FLAVOURS[country.toUpperCase()]) || FALLBACK;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const groups = groupNames.map((name) => name.trim()).filter(Boolean);
  const [groceries, dinner, coffee] = flavour.amounts;
  // The place and the names are drawn first and the group last, so the same
  // draw gives the same place and names whether or not the groups have loaded
  // yet: when they arrive, only the group line changes.
  const place = pick(flavour.places);
  const names = pick(flavour.names);
  return {
    group: groups.length > 0 ? pick(groups) : null,
    place,
    names,
    groceries: grouped(groceries),
    dinner: grouped(dinner),
    coffee: grouped(coffee),
  };
}

/** A whole amount with a thousands comma — the way it is said and the parser reads it. */
function grouped(amount: number): string {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The country whose examples fit a currency — one per currency, the biggest
 *  user of it. The euro is shared, so it takes the phone's own country when that
 *  is a euro country we have examples for, and Germany when it is not. */
const CURRENCY_COUNTRY: Readonly<Record<string, string>> = {
  INR: 'IN',
  USD: 'US',
  GBP: 'GB',
  AED: 'AE',
  SAR: 'SA',
  QAR: 'QA',
  AUD: 'AU',
  NZD: 'NZ',
  CAD: 'CA',
  SGD: 'SG',
  MYR: 'MY',
  LKR: 'LK',
};

/** The euro countries with a flavour of their own. */
const EURO_COUNTRIES: readonly string[] = ['DE', 'FR', 'NL', 'IE'];

/**
 * Which country's examples to show. The currency the person keeps their money in
 * says where they spend it better than the phone's Region setting, which is
 * often left on the US: a phone set to "United States" counting in rupees gets
 * Goa and ₹850, not Yosemite and $85. The phone's country is the fallback.
 */
export function exampleCountry(
  currency: string | null,
  phoneCountry: string | null,
): string | null {
  const code = currency?.toUpperCase() ?? '';
  if (code === 'EUR') {
    const phone = phoneCountry?.toUpperCase() ?? '';
    return EURO_COUNTRIES.includes(phone) ? phone : 'DE';
  }
  return CURRENCY_COUNTRY[code] ?? phoneCountry;
}
