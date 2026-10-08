/**
 * The scenic photograph Home's header wears right now. The person's pick on the
 * Background screen wins (any of the nine photographs), then the build override, then the
 * clock and the device region (`homeHeroPure`). Recomputed when the time slot
 * ends and whenever the app returns to the foreground.
 */

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getLocales } from 'expo-localization';

import { useHeroScenePreference } from '@/lib/heroScenePreference';
import {
  heroForPickedScene,
  msUntilNextBoundary,
  selectHomeHero,
  type HomeHero,
} from '@/lib/homeHeroPure';
import { SCENE_OVERRIDE } from '@/lib/scene';

function clockHero(): HomeHero {
  let regionCode: string | null = null;
  try {
    regionCode = getLocales()[0]?.regionCode ?? null;
  } catch {
    regionCode = null;
  }
  return selectHomeHero(new Date(), { regionCode });
}

export function useHomeHero(): HomeHero {
  const { preference } = useHeroScenePreference();
  const [clock, setClock] = useState<HomeHero>(clockHero);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setClock(clockHero());
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, msUntilNextBoundary(new Date()));
    };
    timer = setTimeout(refresh, msUntilNextBoundary(new Date()));
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return heroForPickedScene(preference) ?? heroForPickedScene(SCENE_OVERRIDE) ?? clock;
}
