/**
 * The Free ceiling on starting groups, wired to this phone.
 *
 * `@waves/core`'s `groupCapGate` decides; this hook feeds it the plan this
 * account holds and how many groups it has started (counted the way the
 * database counts them — its own, not deleted, pairs excluded), then hands
 * screens one guard to call before opening the New Group form or sending the
 * create. A Pro account, or one whose plan is still being read, gets a null
 * gate and the guard waves everything through — the server refuses on its own
 * (`waves_assert_group_cap`), so failing open here costs nothing but a form.
 *
 * Like `useGuestGuard`, the guard both answers and acts: when the ceiling is
 * reached it raises the upgrade prompt and returns `true` so the caller bails.
 * The pattern at the call site is `if (cap.blockCreate()) return;`.
 */

import { useCallback, useMemo } from 'react';

import {
  countsTowardGroupCap,
  groupCapGate,
  materialiseMembers,
  type GroupCapGate,
} from '@waves/core';

import { useGroups } from '@/data/hooks';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';
import { useEntitlement } from '@/lib/useEntitlement';
import { useSync } from '@/sync';

export interface GroupCapGuard {
  /** Null while the plan is unknown — the limit is not applied until it is. */
  gate: GroupCapGate | null;
  /**
   * Call before opening the New Group form or sending a create. Shows the
   * upgrade prompt and returns `true` when one more group may not be started;
   * returns `false` to proceed.
   */
  blockCreate: () => boolean;
}

export function createGroupCapGuard(gate: GroupCapGate | null, send: () => void): GroupCapGuard {
  const blockCreate = (): boolean => {
    if (!gate || gate.canCreate) return false;
    send();
    return true;
  };
  return { gate, blockCreate };
}

export function useGroupCapGuard(): GroupCapGuard {
  const { t } = useStrings();
  const { confirm } = useDialog();
  const entitlement = useEntitlement();
  const viewerId = useViewerId();
  const groups = useGroups();
  const { mirror, queue } = useSync();

  const created = useMemo(() => {
    let count = 0;
    for (const group of groups.data ?? []) {
      const live = materialiseMembers(mirror, queue, { groupId: group.id }).length;
      if (countsTowardGroupCap(group, viewerId, live)) count += 1;
    }
    return count;
  }, [groups.data, mirror, queue, viewerId]);

  const gate = useMemo<GroupCapGate | null>(
    () =>
      entitlement.loading ? null : groupCapGate({ tier: entitlement.tier, createdCount: created }),
    [entitlement.loading, entitlement.tier, created],
  );

  const limit = gate?.limit ?? 0;
  const send = useCallback(() => {
    void confirm({
      title: t.groupCap.title,
      body: fill(t.groupCap.body, { n: limit }),
      confirmLabel: t.groupCap.upgrade,
    }).then((upgrade) => {
      if (upgrade) router.push('/settings/upgrade');
    });
  }, [confirm, t, limit]);

  return useMemo(() => createGroupCapGuard(gate, send), [gate, send]);
}
