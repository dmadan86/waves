/**
 * Every icon the cover picker offers, grouped the way somebody looks for one.
 *
 * What is stored never changes shape: the pick is written to `groups.cover_emoji`
 * as a single emoji, which the web client, the export and every older build
 * already read. The 24 *drawn* marks (`GroupMark`) are listed here by their
 * canonical emoji and draw as vector art; every other entry draws as the
 * character itself, which is what `GroupMark` already does for an emoji it has
 * no drawing for. So adding an icon is adding a row here, and a group that
 * picked one is readable everywhere.
 *
 * Rules the tests hold this file to: no emoji appears twice, no two entries
 * draw as the same mark (🚕 and 🚗 are one mark — only the canonical one is
 * listed), and every drawn mark is reachable.
 */

export const GROUP_ICON_CATEGORY_IDS = [
  'travel',
  'home',
  'food',
  'events',
  'friends',
  'work',
  'sport',
  'money',
  'other',
] as const;

export type GroupIconCategoryId = (typeof GROUP_ICON_CATEGORY_IDS)[number];

export interface GroupIconEntry {
  readonly emoji: string;
  /** Lowercase words the search box matches against, space separated. */
  readonly keywords: string;
}

const e = (emoji: string, keywords: string): GroupIconEntry => ({ emoji, keywords });

export const GROUP_ICON_CATALOG: Readonly<Record<GroupIconCategoryId, readonly GroupIconEntry[]>> =
  {
    travel: [
      e('🏖️', 'beach sea sand goa holiday'),
      e('⛰️', 'mountain hills trek hike manali'),
      e('🏕️', 'tent camping camp outdoors'),
      e('✈️', 'plane flight flying airport trip'),
      e('🚗', 'car road trip drive taxi cab'),
      e('⛵', 'boat sail sailing lake'),
      e('🚂', 'train railway rail journey'),
      e('🚢', 'ship cruise ferry'),
      e('🚁', 'helicopter heli'),
      e('🚲', 'bicycle cycle cycling'),
      e('🏍️', 'bike motorcycle ride'),
      e('🗺️', 'map route plan'),
      e('🧳', 'luggage bags suitcase packing'),
      e('🎒', 'backpack trek rucksack'),
      e('🌴', 'palm tree tropical island'),
      e('🌍', 'world globe earth abroad'),
      e('🗼', 'tower paris landmark'),
      e('🌅', 'sunrise sunset view'),
      e('🛶', 'canoe kayak rafting'),
      e('⛽', 'fuel petrol diesel'),
    ],
    home: [
      e('🏠', 'home house flat rent roommates'),
      e('🛏️', 'bed stay hotel room sleep'),
      e('🔑', 'key keys rent landlord'),
      e('🪴', 'plant plants garden'),
      e('🧹', 'cleaning broom chores maid'),
      e('🚿', 'shower bathroom water'),
      e('💡', 'electricity light power bill'),
      e('🔧', 'repair fix plumber maintenance'),
      e('🔨', 'hammer renovation work'),
      e('🧺', 'laundry washing clothes'),
      e('🚪', 'door entry'),
      e('🪑', 'chair furniture'),
      e('🛒', 'groceries shopping cart supermarket'),
      e('📺', 'tv television cable'),
      e('📶', 'wifi internet broadband'),
      e('🐶', 'dog pet pets'),
      e('🐱', 'cat pet pets'),
      e('🧴', 'supplies toiletries essentials'),
    ],
    food: [
      e('🍽️', 'plate dinner lunch meal restaurant eating'),
      e('🍕', 'pizza slice'),
      e('🍜', 'noodles ramen soup bowl'),
      e('☕', 'coffee tea cafe chai'),
      e('🎂', 'cake birthday dessert'),
      e('🍻', 'beer drinks pub bar cheers'),
      e('🍔', 'burger fast food'),
      e('🍟', 'fries snacks'),
      e('🌮', 'taco mexican'),
      e('🍣', 'sushi japanese'),
      e('🍛', 'curry biryani thali indian'),
      e('🍚', 'rice meal'),
      e('🥗', 'salad healthy'),
      e('🍦', 'ice cream dessert'),
      e('🍎', 'fruit apple'),
      e('🍳', 'breakfast egg brunch'),
      e('🍷', 'wine party'),
      e('🥤', 'juice soft drink soda'),
      e('🍫', 'chocolate sweet'),
      e('🍗', 'chicken non veg'),
    ],
    events: [
      e('🎉', 'party celebration popper'),
      e('🎁', 'gift present surprise'),
      e('💍', 'wedding ring engagement'),
      e('🎊', 'celebrate confetti'),
      e('🥂', 'toast cheers champagne'),
      e('🪔', 'diwali diya festival lamp'),
      e('🎆', 'fireworks new year'),
      e('🎄', 'christmas tree'),
      e('🎃', 'halloween'),
      e('💐', 'flowers bouquet'),
      e('🎤', 'concert karaoke singing'),
      e('🎵', 'music dj'),
      e('🎬', 'movie film cinema'),
      e('🎟️', 'tickets show event'),
      e('📸', 'photos camera shoot'),
      e('🪩', 'disco club night'),
      e('🧧', 'envelope shagun gift money'),
      e('🍾', 'bottle celebrate'),
    ],
    friends: [
      e('👥', 'people group friends team'),
      e('💜', 'heart love favourite'),
      e('👫', 'couple pair together'),
      e('👨‍👩‍👧', 'family kids parents'),
      e('👨‍👩‍👧‍👦', 'family household'),
      e('👯', 'besties twins friends'),
      e('🤝', 'deal partners handshake'),
      e('😀', 'happy smile fun'),
      e('😎', 'cool gang squad'),
      e('🥳', 'party gang celebrate'),
      e('🤗', 'hug care'),
      e('👶', 'baby child kid'),
      e('👵', 'grandma elders family'),
      e('🫂', 'support hug'),
      e('🫶', 'love care'),
      e('🧑‍🤝‍🧑', 'buddies friends'),
      e('🎓', 'college batch school class'),
    ],
    work: [
      e('🏢', 'office building company flat apartment'),
      e('💼', 'work job business briefcase'),
      e('💻', 'laptop computer coding'),
      e('🖥️', 'desktop screen'),
      e('📊', 'chart report numbers'),
      e('📈', 'growth sales'),
      e('📎', 'clip documents'),
      e('📅', 'calendar schedule'),
      e('🧑‍💼', 'colleagues team manager'),
      e('🏭', 'factory shop plant'),
      e('🛠️', 'tools project'),
      e('📞', 'phone calls'),
      e('✏️', 'pencil notes study'),
      e('📚', 'books study library'),
      e('🧪', 'lab science'),
      e('🚀', 'startup launch'),
      e('🖨️', 'printer stationery'),
    ],
    sport: [
      e('⚽', 'football soccer ball match'),
      e('🏐', 'volleyball'),
      e('🏈', 'rugby american football'),
      e('🎾', 'tennis'),
      e('🏓', 'table tennis ping pong'),
      e('🏊', 'swimming pool'),
      e('🚴', 'cycling ride'),
      e('🏋️', 'gym weights fitness'),
      e('🥊', 'boxing'),
      e('🎮', 'gaming video games console'),
      e('🎲', 'dice board games'),
      e('🎯', 'darts target'),
      e('🎳', 'bowling'),
      e('⛳', 'golf'),
      e('🏄', 'surfing'),
      e('🧗', 'climbing'),
      e('🎣', 'fishing'),
      e('🎨', 'art painting'),
      e('🎸', 'guitar band'),
      e('🧘', 'yoga calm'),
    ],
    money: [
      e('💰', 'money coins savings cash'),
      e('🧾', 'receipt bill expenses'),
      e('💵', 'cash notes dollars'),
      e('💳', 'card credit payment'),
      e('🏦', 'bank'),
      e('🪙', 'coin'),
      e('💸', 'spending paying'),
      e('📉', 'loss down'),
      e('🐷', 'piggy bank savings'),
      e('🧮', 'calculator accounts'),
      e('💎', 'diamond jewellery gold'),
      e('🏧', 'atm withdraw'),
      e('📒', 'ledger book khata'),
      e('🤑', 'rich'),
      e('💶', 'euro'),
      e('🔖', 'tag bookmark'),
    ],
    other: [
      e('⭐', 'star favourite'),
      e('🌟', 'glow shine'),
      e('✨', 'sparkle magic'),
      e('💫', 'dizzy shooting'),
      e('🔥', 'fire hot'),
      e('🌙', 'moon night'),
      e('☀️', 'sun day'),
      e('🌈', 'rainbow'),
      e('🍀', 'luck clover'),
      e('🌸', 'flower blossom'),
      e('🦄', 'unicorn'),
      e('🧩', 'puzzle project'),
      e('📌', 'pin place'),
      e('🏷️', 'label tag'),
      e('🔔', 'bell reminder'),
      e('🐾', 'paws pets animals'),
      e('🌊', 'wave water'),
    ],
  };

/** Normalises the way search compares: lowercase, no padding. */
function fold(text: string): string {
  return text.toLocaleLowerCase().trim();
}

/**
 * The entries of one category that match a search, or all of it when the
 * search is empty. `extra` is words the caller knows that the catalog does not
 * (the translated name of a drawn mark), so searching in Tamil or Hindi finds
 * the marks that have a name in that language.
 */
export function filterGroupIcons(
  entries: readonly GroupIconEntry[],
  query: string,
  extra?: (entry: GroupIconEntry) => string,
): readonly GroupIconEntry[] {
  const needle = fold(query);
  if (!needle) return entries;
  const words = needle.split(/\s+/);
  return entries.filter((entry) => {
    const haystack = `${entry.keywords} ${extra?.(entry) ?? ''}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
