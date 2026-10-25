export type Lease = {
  profileId: string;
  kind: 'gate' | 'credit' | 'capped';
  valid(): boolean;
  release(): void;
};
let profile: string | null = null;
let epoch = 0;
let active: Lease | null = null;
const offered = new Set<string>();
const noFill = new Map<string, number>();
export function setProfile(next: string | null) {
  profile = next;
  if (active && active.profileId !== next) {
    epoch++;
    active.release();
  }
}
export function acquire(profileId: string, kind: Lease['kind']): Lease | null {
  if (active) return null;
  const generation = epoch;
  let released = false;
  const lease: Lease = {
    profileId,
    kind,
    valid: () => !released && generation === epoch,
    release: () => {
      released = true;
      if (active === lease) active = null;
    },
  };
  active = lease;
  return lease;
}
export const isBusy = () => active !== null;
export const markOffered = (id: string) => {
  offered.add(id);
};
export const wasOffered = (id: string) => offered.has(id);
export const bumpNoFill = (id: string) => {
  const n = (noFill.get(id) ?? 0) + 1;
  noFill.set(id, n);
  return n;
};
export const resetNoFill = (id: string) => {
  noFill.delete(id);
};
export function __reset() {
  active?.release();
  profile = null;
  epoch++;
  offered.clear();
  noFill.clear();
}
