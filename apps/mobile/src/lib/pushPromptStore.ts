/**
 * Where the notification prompt remembers itself, and the one signal join sends
 * it. Local to the phone: the cadence is about this device's permission.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  EMPTY_PUSH_PROMPT_STATE,
  parsePushPromptState,
  type PushPromptState,
} from './pushPromptPolicy';

const KEY = 'waves.push_prompt_state';

export async function loadPushPromptState(): Promise<PushPromptState> {
  try {
    return parsePushPromptState(await AsyncStorage.getItem(KEY));
  } catch {
    return EMPTY_PUSH_PROMPT_STATE;
  }
}

export async function savePushPromptState(state: PushPromptState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // One repeat at worst.
  }
}

/** Permission came through: forget the dismissals so a later revoke starts fresh. */
export async function resetPushPromptState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to reset that matters.
  }
}

type JoinListener = (groupName: string) => void;
const joinListeners = new Set<JoinListener>();

/** Called by join once somebody is in: the prompt decides whether to show. */
export function requestJoinPushPrompt(groupName: string): void {
  joinListeners.forEach((listener) => listener(groupName));
}

export function onJoinPushPrompt(listener: JoinListener): () => void {
  joinListeners.add(listener);
  return () => {
    joinListeners.delete(listener);
  };
}
