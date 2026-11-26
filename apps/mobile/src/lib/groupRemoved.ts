/**
 * An admin removed this person: RLS means no pull or realtime event says so, only
 * the server's membership list does. The sync engine drops the group from the
 * phone and announces it here, and a root component says it calmly and leaves
 * the group's screens if one is open.
 */
export interface RemovedGroup {
  readonly id: string;
  readonly name: string | null;
}

type Listener = (groups: readonly RemovedGroup[]) => void;
const listeners = new Set<Listener>();

export function onGroupsRemoved(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function announceGroupsRemoved(groups: readonly RemovedGroup[]): void {
  if (groups.length > 0) for (const listener of listeners) listener(groups);
}

/** Whether `pathname` is inside one of the removed groups ("/group/<id>/…"). */
export function insideRemovedGroup(pathname: string, groups: readonly RemovedGroup[]): boolean {
  const id = /^\/group\/([^/]+)/.exec(pathname)?.[1];
  return id !== undefined && groups.some((group) => group.id === id);
}
