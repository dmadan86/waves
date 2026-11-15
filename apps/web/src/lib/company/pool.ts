'use client';

import { useEffect, useMemo, useState } from 'react';

import { poolBalance } from '@waves/core';

import type { CompanyView } from '@/lib/company/view';
import { supabase } from '@/lib/waves';

/**
 * A manager's remaining budget. The server's figure is the truth (it also counts
 * people who moved teams); until it answers, the sum of the entries this browser can read.
 */
export function usePoolBalance(
  groupId: string,
  view: CompanyView,
  managerId: string | null,
  /** Bump to refetch after a write. */
  version = 0,
): bigint | null {
  const [server, setServer] = useState<{ key: string; balance: bigint } | null>(null);
  const key = `${groupId}:${managerId ?? ''}`;
  useEffect(() => {
    if (!managerId) return;
    let active = true;
    void supabase
      .rpc('waves_company_pool_balance', { p_group_id: groupId, p_manager_id: managerId })
      .then(({ data, error }) => {
        if (!active || error || !data) return;
        setServer({ key, balance: BigInt(String((data as { balance: string | number }).balance)) });
      });
    return () => {
      active = false;
    };
  }, [groupId, managerId, version, key]);
  const local = useMemo(
    () => (managerId ? poolBalance(view.entries, managerId).balance : null),
    [view.entries, managerId],
  );
  return (managerId && server?.key === key ? server.balance : null) ?? local;
}
