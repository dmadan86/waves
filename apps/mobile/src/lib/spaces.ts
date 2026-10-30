import AsyncStorage from '@react-native-async-storage/async-storage';

/** A space is Personal or one company, named by its group id. */
export type Space = 'personal' | (string & {});

const key = (userId: string): string => `waves.lastSpace.${userId}`;

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

export async function readLastSpace(userId: string | null): Promise<string | null> {
  if (userId === null) return null;
  try {
    return await AsyncStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

/** Call on an explicit switch only (sheet tap, create, accept invite), never on a deep link. */
export async function rememberSpace(userId: string | null, space: Space): Promise<void> {
  if (userId === null) return;
  try {
    await AsyncStorage.setItem(key(userId), space);
  } catch {
    // Remembering is a convenience; a failed write just means Personal next launch.
  }
}

let coldStartDoneFor: string | null = null;

/** True once per signed-in account per process: the first Home mount may redirect to lastSpace. */
export function takeColdStart(userId: string): boolean {
  if (coldStartDoneFor === userId) return false;
  coldStartDoneFor = userId;
  return true;
}
