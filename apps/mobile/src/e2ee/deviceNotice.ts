/**
 * "<Name> added a new phone." The mailbox compares each group's device list with the one
 * it saw last time; a partner device that was not there before, belonging to a partner who
 * already had a phone, becomes a dismissable notice.
 */

export interface KnownDevice {
  readonly deviceId: string;
  readonly memberId: string;
}

export interface DeviceNotice extends KnownDevice {
  readonly groupId: string;
  /** The partner removed this phone (rather than added it). */
  readonly removed?: boolean;
}

/** Partner phones that were in the last list and are gone now. */
export function removedDevices(
  known: readonly KnownDevice[] | null,
  current: readonly KnownDevice[],
  myMemberId: string | null,
): KnownDevice[] {
  if (known === null) return [];
  const has = new Set(current.map((d) => d.deviceId));
  return known.filter((d) => !has.has(d.deviceId) && d.memberId !== myMemberId);
}

/** `known` is null the first time a group is seen: that is a baseline, never a notice. */
export function diffDevices(
  known: readonly KnownDevice[] | null,
  current: readonly KnownDevice[],
  myMemberId: string | null,
): KnownDevice[] {
  if (known === null) return [];
  const had = new Set(known.map((d) => d.deviceId));
  const hadPhone = new Set(known.map((d) => d.memberId));
  return current.filter(
    (d) => !had.has(d.deviceId) && d.memberId !== myMemberId && hadPhone.has(d.memberId),
  );
}

export interface Meta {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const memoryMeta = (): Meta => {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) };
};

const KEY = 'notices';

export class NoticeStore {
  private items: DeviceNotice[] = [];
  private listeners = new Set<() => void>();
  version = 0;
  constructor(private readonly meta: Meta) {}

  async load(): Promise<void> {
    try {
      this.items = JSON.parse((await this.meta.get(KEY)) ?? '[]') as DeviceNotice[];
    } catch {
      this.items = [];
    }
    this.changed();
  }

  list(groupId?: string): readonly DeviceNotice[] {
    return groupId ? this.items.filter((n) => n.groupId === groupId) : this.items;
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  async add(notices: readonly DeviceNotice[]): Promise<void> {
    if (notices.length === 0) return;
    this.items = [...this.items, ...notices];
    await this.save();
  }

  dismiss(deviceId: string): Promise<void> {
    this.items = this.items.filter((n) => n.deviceId !== deviceId);
    return this.save();
  }

  clear(): void {
    this.items = [];
    this.changed();
  }

  private async save(): Promise<void> {
    this.changed();
    await this.meta.set(KEY, JSON.stringify(this.items));
  }

  private changed(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }
}
