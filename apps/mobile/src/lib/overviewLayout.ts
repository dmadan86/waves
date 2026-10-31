/**
 * The company Overview's card layout, as a pure model: which cards a role has, in what default order,
 * and how a saved layout merges with that catalogue when a later version adds or drops a card.
 * The grid only orders and hides cards; what a card shows is the card's own business.
 */

export type OverviewRole = 'owner' | 'manager';

export type CardId =
  | 'attendance'
  | 'money'
  | 'attention'
  | 'upcoming'
  | 'activity'
  | 'budget'
  | 'stats'
  | 'quick'
  | 'workday'
  | 'team';

/** Default order per role. The first card is the locked one: always first, never hidden. */
export const DEFAULT_CARDS: Record<OverviewRole, readonly CardId[]> = {
  owner: ['attendance', 'money', 'attention', 'upcoming', 'activity'],
  manager: [
    'attendance',
    'attention',
    'upcoming',
    'budget',
    'stats',
    'quick',
    'workday',
    'team',
    'activity',
  ],
};

export interface OverviewLayout {
  /** Shown cards, top to bottom. */
  order: CardId[];
  /** Cards the person took off; they come back from the Hidden list. */
  hidden: CardId[];
}

export const isLocked = (role: OverviewRole, id: CardId): boolean => DEFAULT_CARDS[role][0] === id;

export const defaultLayout = (role: OverviewRole): OverviewLayout => ({
  order: [...DEFAULT_CARDS[role]],
  hidden: [],
});

/**
 * Saved JSON (anything, it came off a disk or a server) merged with the role's catalogue: unknown or repeated
 * ids are dropped, the locked card goes first, and a card the saved layout has never seen (added by a newer
 * version) appears right after the card that precedes it by default.
 */
export function resolveLayout(role: OverviewRole, saved: unknown): OverviewLayout {
  const catalogue = DEFAULT_CARDS[role];
  const known = new Set<CardId>(catalogue);
  const list = (v: unknown): CardId[] =>
    Array.isArray(v) ? (v.filter((x) => known.has(x as CardId)) as CardId[]) : [];
  const raw = (saved ?? {}) as { order?: unknown; hidden?: unknown };
  const seen = new Set<CardId>();
  const take = (ids: CardId[]): CardId[] =>
    ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  const locked = catalogue[0]!;
  seen.add(locked);
  const order = take(list(raw.order));
  const hidden = take(list(raw.hidden));
  order.unshift(locked);
  catalogue.forEach((id, i) => {
    if (seen.has(id)) return;
    const before = catalogue[i - 1]!;
    order.splice(order.indexOf(before) + 1 || order.length, 0, id);
    seen.add(id);
  });
  return { order, hidden };
}

/** Moves a card one place; the locked card neither moves nor is passed. */
export function moveCard(
  role: OverviewRole,
  layout: OverviewLayout,
  id: CardId,
  delta: -1 | 1,
): OverviewLayout {
  const i = layout.order.indexOf(id);
  const j = i + delta;
  if (i < 0 || isLocked(role, id) || j < 1 || j >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[i], order[j]] = [order[j]!, order[i]!];
  return { ...layout, order };
}

/** Takes a card off the Overview. The locked card stays. */
export function hideCard(role: OverviewRole, layout: OverviewLayout, id: CardId): OverviewLayout {
  if (isLocked(role, id) || !layout.order.includes(id)) return layout;
  return { order: layout.order.filter((c) => c !== id), hidden: [...layout.hidden, id] };
}

/** Puts a hidden card back at the bottom. */
export function showCard(layout: OverviewLayout, id: CardId): OverviewLayout {
  if (!layout.hidden.includes(id)) return layout;
  return { order: [...layout.order, id], hidden: layout.hidden.filter((c) => c !== id) };
}

/** After a drag: the locked card first, then the dragged order of the rest. */
export function withOrder(
  role: OverviewRole,
  layout: OverviewLayout,
  rest: CardId[],
): OverviewLayout {
  return { ...layout, order: [DEFAULT_CARDS[role][0]!, ...rest] };
}
