/**
 * Device-local choices about dates: which festivals are switched off and which
 * occurrences were answered "Not this time". Per account, in AsyncStorage —
 * nothing here needs to follow the person to another phone.
 */

import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/lib/auth';

interface State {
  readonly owner: string;
  readonly festivalsOff: readonly string[];
  readonly dismissed: readonly string[];
}

const OFF_KEY = 'waves.dates.festivals_off';
const DISMISSED_KEY = 'waves.dates.dismissed';
const NONE: State = { owner: '', festivalsOff: [], dismissed: [] };

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
  const [festivalsOff, dismissed] = await Promise.all([
    readList(`${OFF_KEY}.${owner}`),
    readList(`${DISMISSED_KEY}.${owner}`),
  ]);
  set({ owner, festivalsOff, dismissed });
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

export function setFestivalOff(id: string, off: boolean): void {
  if (!state.owner) return;
  const festivalsOff = off
    ? [...new Set([...state.festivalsOff, id])]
    : state.festivalsOff.filter((f) => f !== id);
  set({ ...state, festivalsOff });
  void AsyncStorage.setItem(`${OFF_KEY}.${state.owner}`, JSON.stringify(festivalsOff)).catch(
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
