/**
 * Where the scenic look applies. The personal social screens (Home, Friends,
 * groups, people) keep the photo-and-glass design; company screens, the
 * Personal money tab and settings use the calm system. `ScenicTheme` serves the
 * old tokens to one subtree, so a screen opts in by wrapping its default export.
 */

import type { ComponentType } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ScenicTheme } from '@waves/ui';
import { GroupType } from '@/data/types';

import { useGroup } from '@/data/hooks';

/** A screen that is always scenic (Home, Friends, person pages). */
export function withScenic<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function Scenic(props: P) {
    return (
      <ScenicTheme>
        <Screen {...props} />
      </ScenicTheme>
    );
  }
  return Scenic;
}

/** A /group/[id]/... screen: scenic for personal groups, calm for a company's. */
export function withScenicGroup<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function ScenicGroup(props: P) {
    const { id } = useLocalSearchParams<{ id?: string }>();
    const { group } = useGroup(id ?? '');
    if (group.data?.type === GroupType.Company) return <Screen {...props} />;
    return (
      <ScenicTheme>
        <Screen {...props} />
      </ScenicTheme>
    );
  }
  return ScenicGroup;
}
