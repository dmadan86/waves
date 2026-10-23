/**
 * Pure diff logic for a `group_updated / families` activity row.
 *
 * **New rows** (written by 20261026120000_family_activity_detail) carry:
 *   `{ field: 'families', from: <GroupUnits|null>, to: <GroupUnits|null>,
 *      fromCount: <int>, toCount: <int> }`
 * where `from`/`to` are the full `groups.units` jsonb objects so the app can
 * produce specific titles: "Created Sharma family", "Renamed Family1 to Sharma
 * family", "Moved Anoop to Family1", etc.
 *
 * **Old rows** (written by 20261025100000_group_units) carry:
 *   `{ field: 'families', from: <count_int>, to: <count_int> }`
 * The helpers below accept both shapes:
 *  - When `from`/`to` are objects → map diff (specific titles).
 *  - When `from`/`to` are numbers → count-based titles (legacy path).
 *  - `fromCount`/`toCount` are also accepted as the count source for either path.
 *
 * All helpers are pure (no locale, no native module), so they can be imported
 * by the pure wording tests without any native setup.
 */

/** A single unit entry as the payload delivers it (permissive — never crash on bad data). */
interface RawUnit {
  name?: unknown;
  members?: unknown;
  head?: unknown;
  /** Optional: per-member weight. Values < 1 mark a child. */
  weights?: unknown;
}

/** A validated unit with the fields we can act on. */
interface Unit {
  name: string;
  members: readonly string[];
  head: string | null;
  /** weight[memberId] < 1 → child. Absent key → adult. */
  weights: ReadonlyMap<string, number>;
}

/** Parse a raw units object into a keyed map. Returns an empty map on bad input. */
function parseUnits(raw: unknown): ReadonlyMap<string, Unit> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return new Map();
  const result = new Map<string, Unit>();
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as RawUnit | null | undefined;
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) continue;
    const rawMembers = Array.isArray(entry.members) ? entry.members : [];
    const members = rawMembers.filter((m): m is string => typeof m === 'string');
    const head = typeof entry.head === 'string' && members.includes(entry.head) ? entry.head : null;
    const weightsMap = new Map<string, number>();
    if (typeof entry.weights === 'object' && entry.weights !== null) {
      for (const [mid, w] of Object.entries(entry.weights as Record<string, unknown>)) {
        if (typeof w === 'number' && Number.isFinite(w)) weightsMap.set(mid, w);
      }
    }
    result.set(id, { name, members, head, weights: weightsMap });
  }
  return result;
}

/** Look up the display name for a member id, falling back to the id itself. */
function memberName(memberId: string, memberNames: ReadonlyMap<string, string>): string {
  return memberNames.get(memberId) ?? memberId;
}

// ─────────────────────────────────────── change descriptors ──

export type FamilyChange =
  | { kind: 'created'; familyName: string }
  | { kind: 'removed'; familyName: string }
  | { kind: 'renamed'; from: string; to: string }
  | { kind: 'memberAdded'; member: string; familyName: string }
  | { kind: 'memberRemoved'; member: string; familyName: string }
  | { kind: 'memberMoved'; member: string; from: string; to: string }
  | { kind: 'headChanged'; member: string; familyName: string }
  | { kind: 'markedChild'; member: string; familyName: string }
  | { kind: 'markedAdult'; member: string; familyName: string };

/**
 * Diff two `GroupUnits` maps and return the ordered list of changes.
 *
 * Member ids are resolved to display names via `memberNames`. The diff order is:
 *  1. Created families (by unit id, stable)
 *  2. Removed families
 *  3. Renames (same unit id, different name)
 *  4. Member moves (same member, different unit)
 *  5. Members added to a unit that existed before
 *  6. Members removed from a unit that existed before
 *  7. Head changes
 *  8. Child / adult marking changes
 *
 * Returns an empty array when the maps are equivalent.
 */
export function diffFamilyMaps(
  fromRaw: unknown,
  toRaw: unknown,
  memberNames: ReadonlyMap<string, string> = new Map(),
): FamilyChange[] {
  const fromMap = parseUnits(fromRaw);
  const toMap = parseUnits(toRaw);

  const changes: FamilyChange[] = [];

  // 1 & 2 — created / removed units
  for (const [id, unit] of toMap) {
    if (!fromMap.has(id)) {
      changes.push({ kind: 'created', familyName: unit.name });
    }
  }
  for (const [id, unit] of fromMap) {
    if (!toMap.has(id)) {
      changes.push({ kind: 'removed', familyName: unit.name });
    }
  }

  // 3 — renames (same id, different name)
  for (const [id, toUnit] of toMap) {
    const fromUnit = fromMap.get(id);
    if (fromUnit && fromUnit.name !== toUnit.name) {
      changes.push({ kind: 'renamed', from: fromUnit.name, to: toUnit.name });
    }
  }

  // Build: memberId → unit id, for both sides
  const fromMemberId2Unit = new Map<string, string>();
  for (const [id, unit] of fromMap) {
    for (const mid of unit.members) fromMemberId2Unit.set(mid, id);
  }
  const toMemberId2Unit = new Map<string, string>();
  for (const [id, unit] of toMap) {
    for (const mid of unit.members) toMemberId2Unit.set(mid, id);
  }

  // Collect all member ids that appear in either side
  const allMembers = new Set([...fromMemberId2Unit.keys(), ...toMemberId2Unit.keys()]);

  const movedMembers = new Set<string>();

  // 4 — moves (member changed unit)
  for (const mid of allMembers) {
    const fromUnitId = fromMemberId2Unit.get(mid) ?? null;
    const toUnitId = toMemberId2Unit.get(mid) ?? null;
    if (fromUnitId !== null && toUnitId !== null && fromUnitId !== toUnitId) {
      movedMembers.add(mid);
      const fromUnit = fromMap.get(fromUnitId)!;
      const toUnit = toMap.get(toUnitId)!;
      changes.push({
        kind: 'memberMoved',
        member: memberName(mid, memberNames),
        from: fromUnit.name,
        to: toUnit.name,
      });
    }
  }

  // 5 & 6 — added / removed within existing units (exclude moved members)
  for (const mid of allMembers) {
    if (movedMembers.has(mid)) continue;
    const fromUnitId = fromMemberId2Unit.get(mid) ?? null;
    const toUnitId = toMemberId2Unit.get(mid) ?? null;

    if (fromUnitId === null && toUnitId !== null) {
      const toUnit = toMap.get(toUnitId)!;
      // Only log add if the unit existed before (otherwise covered by 'created')
      if (fromMap.has(toUnitId)) {
        changes.push({
          kind: 'memberAdded',
          member: memberName(mid, memberNames),
          familyName: toUnit.name,
        });
      }
    } else if (fromUnitId !== null && toUnitId === null) {
      const fromUnit = fromMap.get(fromUnitId)!;
      // Only log remove if the unit still exists (otherwise covered by 'removed')
      if (toMap.has(fromUnitId)) {
        changes.push({
          kind: 'memberRemoved',
          member: memberName(mid, memberNames),
          familyName: fromUnit.name,
        });
      }
    }
  }

  // 7 — head changes (only for units that existed both before and after)
  for (const [id, toUnit] of toMap) {
    const fromUnit = fromMap.get(id);
    if (!fromUnit) continue;
    if ((fromUnit.head ?? null) !== (toUnit.head ?? null) && toUnit.head) {
      const toUnitName = toUnit.name;
      changes.push({
        kind: 'headChanged',
        member: memberName(toUnit.head, memberNames),
        familyName: toUnitName,
      });
    }
  }

  // 8 — child / adult marking changes (weights, optional)
  for (const [id, toUnit] of toMap) {
    const fromUnit = fromMap.get(id);
    if (!fromUnit) continue;
    const allUnitMembers = new Set([...fromUnit.members, ...toUnit.members]);
    for (const mid of allUnitMembers) {
      const fromW = fromUnit.weights.get(mid);
      const toW = toUnit.weights.get(mid);
      const wasChild = fromW !== undefined && fromW < 1;
      const isChild = toW !== undefined && toW < 1;
      if (!wasChild && isChild) {
        changes.push({
          kind: 'markedChild',
          member: memberName(mid, memberNames),
          familyName: toUnit.name,
        });
      } else if (wasChild && !isChild) {
        changes.push({
          kind: 'markedAdult',
          member: memberName(mid, memberNames),
          familyName: toUnit.name,
        });
      }
    }
  }

  return changes;
}

/**
 * Render the first `FamilyChange` as a human-readable title string.
 *
 * Returns null when the change list is empty.
 */
export function renderFamilyChange(change: FamilyChange): string {
  switch (change.kind) {
    case 'created':
      return `Created ${change.familyName}`;
    case 'removed':
      return `Removed ${change.familyName}`;
    case 'renamed':
      return `Renamed ${change.from} to ${change.to}`;
    case 'memberMoved':
      return `Moved ${change.member} to ${change.to}`;
    case 'memberAdded':
      return `Added ${change.member} to ${change.familyName}`;
    case 'memberRemoved':
      return `Took ${change.member} out of ${change.familyName}`;
    case 'headChanged':
      return `Made ${change.member} head of ${change.familyName}`;
    case 'markedChild':
      return `Marked ${change.member} as a child in ${change.familyName}`;
    case 'markedAdult':
      return `Marked ${change.member} as an adult in ${change.familyName}`;
  }
}

/**
 * Headline for a `group_updated / families` row when `from`/`to` are objects.
 *
 * Renders the first change and appends " and N more" when there are multiple.
 * Returns null when there are no detectable changes (caller keeps the static string).
 */
export function familyMapHeadline(
  fromRaw: unknown,
  toRaw: unknown,
  memberNames: ReadonlyMap<string, string> = new Map(),
): string | null {
  const changes = diffFamilyMaps(fromRaw, toRaw, memberNames);
  if (changes.length === 0) return null;
  const first = renderFamilyChange(changes[0]!);
  if (changes.length === 1) return first;
  return `${first} and ${changes.length - 1} more`;
}

// ─────────────────────────────── legacy count-based path ──

export interface FamiliesStrings {
  /** families added from a zero base (going from none to some). */
  setupFamilies: string;
  /** One family was added to an existing set. */
  addedFamily: string;
  /** One family was removed; at least one remains. */
  removedFamily: string;
  /** All families were cleared. */
  clearedFamilies: string;
  /** Any other count change (e.g. added or removed multiple at once). */
  changedFamilies: string;
}

export type FamiliesHeadline =
  'setupFamilies' | 'addedFamily' | 'removedFamily' | 'clearedFamilies' | 'changedFamilies';

/**
 * Derive the appropriate headline key from the before/after family counts.
 *
 * Returns `null` when the counts are absent or non-integer (caller keeps the
 * static "Changed the families" string for those rows).
 */
export function familyChangeKey(from: unknown, to: unknown): FamiliesHeadline | null {
  if (typeof from !== 'number' || typeof to !== 'number') return null;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const f = Math.round(from);
  const t = Math.round(to);
  if (f === t) return null;
  if (f === 0 && t > 0) return 'setupFamilies';
  if (t === 0 && f > 0) return 'clearedFamilies';
  if (t === f + 1) return 'addedFamily';
  if (t === f - 1) return 'removedFamily';
  return 'changedFamilies';
}

/**
 * Returns the localised headline string for a families change, or `null` when
 * the payload lacks usable counts (caller should keep the static string).
 */
export function familyChangeHeadline(
  from: unknown,
  to: unknown,
  strings: FamiliesStrings,
): string | null {
  const key = familyChangeKey(from, to);
  return key ? strings[key] : null;
}

// ─────────────────────────────────────────── unified entry ──

/**
 * The single call site for a `group_updated / families` row.
 *
 * **Decision tree:**
 *  1. If `from` or `to` is an object → map diff → specific title.
 *  2. If `from` and `to` are numbers → count-based title (new payload `from`/`to`
 *     are objects, so this path is only hit by old rows or test overrides).
 *  3. If `fromCount`/`toCount` are numbers → count-based title (the new payload
 *     always carries these alongside the maps, so old builds reading `fromCount`/
 *     `toCount` also land here after a trigger upgrade).
 *  4. Otherwise → null (caller renders the static string).
 *
 * `memberNames` is a map from member id to display name, used only for the
 * map-diff path. It is optional: absent ids fall back to the raw id.
 */
export function familiesHeadline(
  payload: {
    from?: unknown;
    to?: unknown;
    fromCount?: unknown;
    toCount?: unknown;
  },
  strings: FamiliesStrings,
  memberNames: ReadonlyMap<string, string> = new Map(),
): string | null {
  const { from, to, fromCount, toCount } = payload;

  // Path 1: rich diff
  if ((typeof from === 'object' && from !== null) || (typeof to === 'object' && to !== null)) {
    return (
      familyMapHeadline(from, to, memberNames) ?? familyChangeHeadline(fromCount, toCount, strings)
    );
  }

  // Path 2: old-style integers in from/to
  if (typeof from === 'number' || typeof to === 'number') {
    return familyChangeHeadline(from, to, strings);
  }

  // Path 3: fromCount/toCount (new trigger, old build reading the wrong fields)
  if (typeof fromCount === 'number' || typeof toCount === 'number') {
    return familyChangeHeadline(fromCount, toCount, strings);
  }

  return null;
}
