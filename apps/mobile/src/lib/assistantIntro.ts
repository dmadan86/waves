/**
 * The first-run intro card: shown once per account, on this phone.
 *
 * "I'll ask one or two quick things so the expense is complete." One
 * AsyncStorage entry per signed-in account (`waves.assistant_intro_seen:<id>`),
 * the same per-account pattern as the voice consent and the follow-up prefs.
 * Unreadable storage reads as "not seen yet", and a write that fails is
 * swallowed: the worst outcome is seeing the card once more.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const introKey = (viewerId: string): string => `waves.assistant_intro_seen:${viewerId}`;

/** Only an explicit "1" counts as seen; anything else (null, junk) shows the card. */
export function parseIntroSeen(raw: string | null | undefined): boolean {
  return raw === '1';
}

export async function readIntroSeen(viewerId: string): Promise<boolean> {
  try {
    return parseIntroSeen(await AsyncStorage.getItem(introKey(viewerId)));
  } catch {
    return false;
  }
}

export async function writeIntroSeen(viewerId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(introKey(viewerId), '1');
  } catch {
    // Seeing the card once more is the whole cost.
  }
}

export interface AssistantIntroHandle {
  /** False until storage has answered; nothing is shown meanwhile. */
  readonly ready: boolean;
  readonly seen: boolean;
  /** "Got it": hide now, remember for good. */
  readonly dismiss: () => void;
}

export function useAssistantIntro(viewerId: string | null | undefined): AssistantIntroHandle {
  const [state, setState] = useState<{ ready: boolean; seen: boolean }>({
    ready: false,
    seen: false,
  });

  useEffect(() => {
    if (!viewerId) return undefined;
    let live = true;
    void readIntroSeen(viewerId).then((seen) => {
      if (live) setState({ ready: true, seen });
    });
    return () => {
      live = false;
    };
  }, [viewerId]);

  const dismiss = useCallback((): void => {
    setState({ ready: true, seen: true });
    if (viewerId) void writeIntroSeen(viewerId);
  }, [viewerId]);

  return { ready: Boolean(viewerId) && state.ready, seen: state.seen, dismiss };
}
