/**
 * Device-local choices about dates: which festivals were switched on and which
 * occurrences were answered "Not this time". Per account, in AsyncStorage —
 * nothing here needs to follow the person to another phone.
 */

import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/lib/auth';

interface State {
  readonly owner: string;
  readonly festivalsOn: readonly string[];
  readonly dismissed: readonly string[];
}

const ON_KEY = 'waves.dates.festivals_on';
const DISMISSED_KEY = 'waves.dates.dismissed';
const NONE: State = { owner: '', festivalsOn: [], dismissed: [] };

let state: State = NONE;
const listeners = new Set<() => void>();
const set = (next: State): void => {
  state = next;
  listeners.forEach((l) => l());
};

const readList = async (key: string): Promise<string[]> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

async function load(owner: string): Promise<void> {
  const [festivalsOn, dismissed] = await Promise.all([
    readList(`${ON_KEY}.${owner}`),
    readList(`${DISMISSED_KEY}.${owner}`),
  ]);
  set({ owner, festivalsOn, dismissed });
}

export function dismissOccurrence(key: string): void {
  if (!state.owner || state.dismissed.includes(key)) return;
  // Old occurrences can never come back, so only the recent ones are worth keeping.
  const dismissed = [...state.dismissed, key].slice(-60);
  set({ ...state, dismissed });
  void AsyncStorage.setItem(`${DISMISSED_KEY}.${state.owner}`, JSON.stringify(dismissed)).catch(
    () => {},
  );
}

// The old festivals_off key is never read: everything starts off, nobody is switched on for them.
export function setFestivalOn(id: string, on: boolean): void {
  if (!state.owner) return;
  const festivalsOn = on
    ? [...new Set([...state.festivalsOn, id])]
    : state.festivalsOn.filter((f) => f !== id);
  set({ ...state, festivalsOn });
  void AsyncStorage.setItem(`${ON_KEY}.${state.owner}`, JSON.stringify(festivalsOn)).catch(
    () => {},
  );
}

export function useDatePrefs(): State {
  const { session } = useAuth();
  const owner = session?.user?.id ?? '';
  useEffect(() => {
    if (owner && state.owner !== owner) void load(owner);
  }, [owner]);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
