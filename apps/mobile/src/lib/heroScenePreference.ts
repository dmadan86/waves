/**
 * Which scene the Home and Personal heroes wear: the clock's (`sceneFor`) unless
 * the person has picked one on the Background screen. The pick is remembered on
 * the device and shared by every hero through one small store, so changing it
 * on the picker turns both heroes at once.
 *
 * The pick is one of Home's nine photographs (`HomeHero`); the painted heroes on
 * the other screens wear the nearest scene (`sceneForHero`). Picks saved by the
 * old six-scene picker still read: winter, which is gone, becomes Automatic.
 *
 * Null means "automatic". The build-time `EXPO_PUBLIC_HERO_SCENE` override sits
 * under the person's own choice and over the clock — for testing a scene on a
 * device without waiting for it.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { heroForPickedScene, type HomeHero } from '@/lib/homeHeroPure';
import { SCENE_OVERRIDE, sceneFor, sceneForHero, type Scene } from '@/lib/scene';

const KEY = 'waves.hero_scene';

let preference: HomeHero | null = null;
// Set once the person picks on this run: the stored answer, still being read,
// must not then land on top of the choice they have just made.
let pickedThisRun = false;
const listeners = new Set<() => void>();

// Read once at start-up; until it lands the heroes follow the clock, which is
// also what they do for everyone who has never picked.
void AsyncStorage.getItem(KEY)
  .then((stored) => {
    const parsed = heroForPickedScene(stored);
    if (!pickedThisRun && parsed && parsed !== preference) {
      preference = parsed;
      listeners.forEach((listener) => listener());
    }
  })
  .catch(() => {});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The person's pick, or null for automatic, and the way to change it. */
export function useHeroScenePreference(): {
  preference: HomeHero | null;
  setPreference: (next: HomeHero | null) => void;
} {
  const current = useSyncExternalStore(subscribe, () => preference);
  return { preference: current, setPreference: setHeroScenePreference };
}

export function setHeroScenePreference(next: HomeHero | null): void {
  pickedThisRun = true;
  preference = next;
  listeners.forEach((listener) => listener());
  const write = next ? AsyncStorage.setItem(KEY, next) : AsyncStorage.removeItem(KEY);
  void write.catch(() => {});
}

/**
 * The scene a hero should wear right now: the person's pick, else the build's
 * override, else the clock's — re-read every few minutes so an app left open
 * across sunset turns with the sky.
 */
export function useHeroScene(): Scene {
  const { preference: picked } = useHeroScenePreference();
  const [clock, setClock] = useState(() => sceneFor(new Date(), { override: SCENE_OVERRIDE }));
  useEffect(() => {
    const timer = setInterval(
      () => setClock(sceneFor(new Date(), { override: SCENE_OVERRIDE })),
      5 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, []);
  return sceneForHero(picked) ?? clock;
}
