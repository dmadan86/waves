import AsyncStorage from '@react-native-async-storage/async-storage';

/** A space is Personal or one company, named by its group id. */
export type Space = 'personal' | (string & {});

const key = (userId: string): string => `waves.lastSpace.${userId}`;
// Personal overwrites lastSpace, so the Company tab keeps its own last-company memory.
const companyKey = (userId: string): string => `waves.lastCompany.${userId}`;

/** Groups of every type except company: companies live in their own space. */
export function groupsOutsideCompanies<T extends { type: string }>(groups: readonly T[]): T[] {
  return groups.filter((group) => group.type !== 'company');
}

/** The remembered space if it is still one of the viewer's companies, else Personal. */
export function resolveSpace(stored: string | null, companyIds: readonly string[]): Space {
  return stored !== null && companyIds.includes(stored) ? stored : 'personal';
}

/** Where the shared bar's Company tab goes: the last company, the only one, or the list. */
export function companyTabTarget(
  companyIds: readonly string[],
  lastSpace: string | null,
): string | null {
  if (companyIds.length === 0) return null;
  if (lastSpace !== null && companyIds.includes(lastSpace)) return `/group/${lastSpace}`;
  return companyIds.length === 1 ? `/group/${companyIds[0]}` : '/companies';
}

export async function readLastSpace(
  userId: string | null,
  company = false,
): Promise<string | null> {
  if (userId === null) return null;
  try {
    return await AsyncStorage.getItem((company ? companyKey : key)(userId));
  } catch {
    return null;
  }
}

// What this process last wrote (or saw written) per account, so a follow-the-route write only
// happens on a real change and never undoes an explicit switch.
const written = new Map<string, Space>();

/** Screens that open over a space without being in it. */
const TRANSIENT_GROUP_SCREENS = new Set(['settings', 'invite', 'export']);
const PERSONAL_TABS = new Set(['index', 'friends', 'me', 'captures']);

/**
 * The space the focused route belongs to, or null for neutral screens (settings, modals,
 * companies list...) that must not flip it. Company: any route of a company the viewer is in.
 */
export function spaceForRoute(
  segments: readonly string[],
  groupId: string | null,
  companyIds: readonly string[],
): Space | null {
  const [root, screen, leaf] = segments;
  if (root === 'group')
    return groupId !== null &&
      companyIds.includes(groupId) &&
      !TRANSIENT_GROUP_SCREENS.has(leaf ?? '')
      ? groupId
      : null;
  if (root === 'personal') return 'personal';
  if (root === '(tabs)') return PERSONAL_TABS.has(screen ?? 'index') ? 'personal' : null;
  return null;
}

/** The Home tab: its mount owns the cold-start redirect, so it must not overwrite lastSpace yet. */
export const isHomeTab = (segments: readonly string[]): boolean =>
  segments[0] === '(tabs)' && (segments[1] ?? 'index') === 'index';

/** Follow the route: write only when the space differs from what is already remembered. */
export async function followSpace(userId: string | null, space: Space): Promise<void> {
  if (userId === null || written.get(userId) === space) return;
  await rememberSpace(userId, space);
}

/** Call on an explicit switch (sheet tap, create, accept invite); the cold-start redirect never calls it. */
export async function rememberSpace(userId: string | null, space: Space): Promise<void> {
  if (userId === null) return;
  written.set(userId, space);
  try {
    await AsyncStorage.setItem(key(userId), space);
    if (space !== 'personal') await AsyncStorage.setItem(companyKey(userId), space);
  } catch {
    // Remembering is a convenience; a failed write just means Personal next launch.
  }
}

let coldStartDoneFor: string | null = null;

export const coldStartSettled = (userId: string): boolean => coldStartDoneFor === userId;

/** A route other than Home was reached first (deep link, notification): no redirect later. */
export function settleColdStart(userId: string): void {
  coldStartDoneFor = userId;
}

/** True once per signed-in account per process: the first Home mount may redirect to lastSpace. */
export function takeColdStart(userId: string): boolean {
  if (coldStartDoneFor === userId) return false;
  coldStartDoneFor = userId;
  return true;
}
