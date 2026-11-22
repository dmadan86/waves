import type { OverflowMenuItem } from '@/components/OverflowMenu';

/**
 * The Personal/Shared switcher rows: the current space first with a tick, the
 * other one beside it, and the couple/home groups after (Personal side) or
 * between (Shared side). Pure; the hook supplies labels and navigation.
 */
export function buildSpaceSwitchItems(input: {
  shared: boolean;
  labels: { shared: string; personal: string };
  groups: readonly { id: string; type: string }[];
  groupLabel: (group: { id: string; type: string }) => string;
  goPersonal: () => void;
  goShared: () => void;
  openGroup: (id: string) => void;
}): OverflowMenuItem[] {
  const { shared, labels, groups } = input;
  const personalItem: OverflowMenuItem = {
    icon: shared ? 'people-outline' : 'checkmark',
    label: labels.personal,
    onPress: shared ? input.goPersonal : () => undefined,
  };
  const sharedItem: OverflowMenuItem = {
    icon: shared ? 'checkmark' : 'people-outline',
    label: labels.shared,
    onPress: shared ? () => undefined : input.goShared,
  };
  const groupItems: OverflowMenuItem[] = groups
    .filter((group) => group.type === 'couple' || group.type === 'home')
    .map((group) => ({
      icon: (group.type === 'couple' ? 'heart-outline' : 'home-outline') as OverflowMenuItem['icon'],
      label: input.groupLabel(group),
      onPress: () => input.openGroup(group.id),
    }));
  return shared
    ? [sharedItem, personalItem, ...groupItems]
    : [personalItem, ...groupItems, sharedItem];
}
