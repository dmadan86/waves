/**
 * Everything the person screen and the Who-pays-whom screen both need to know
 * about one other person: who they are, what is between you group by group, and
 * what you may be shown of them.
 *
 * Two screens used to work this out separately and could disagree. Now the
 * figures come from one place — `usePairBalances`, which is `pairBalances` in
 * core over the same ledger the Friends list sums — and the identity rules
 * (a blocked person is the anonymous ghost everywhere, even before the block
 * store has hydrated) live here once.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchPersonProfile, type PersonProfileRow } from '@/data/api';
import { useBlockedUsers } from '@/data/blocked';
import { usePairBalances, type PairGroupMeta } from '@/data/hooks';
import { useAvatarUrl } from '@/components/ProfileAvatar';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { currencyTotals, type CurrencyTotal } from '@/lib/friendsTotals';
import { personAvatarPath } from '@/lib/personDetail';

/** One shared group, with what the pair owes in it (empty `lines` when square). */
export interface PairGroupRow extends PairGroupMeta {
  readonly lines: readonly {
    readonly currency: string;
    readonly net: bigint;
    readonly direct: bigint;
    readonly basis: 'direct' | 'simplified';
  }[];
}

export interface PairPerson {
  profile: PersonProfileRow | null;
  /** What to call them: the generic "Someone" while blocked or unknown. */
  title: string;
  /** Their real name, for sentences the viewer has chosen to act in (confirm block). */
  realName: string;
  masked: boolean;
  blocked: boolean;
  ready: boolean;
  isRealPerson: boolean;
  unregistered: boolean;
  photo: string | null;
  /** Every group you share, the ones holding a balance first. */
  groups: PairGroupRow[];
  /** One non-zero total per currency, biggest first. */
  totals: readonly CurrencyTotal[];
  loading: boolean;
  refetch: () => void;
}

export function usePairPerson(key: string, nameParam?: string): PairPerson {
  const { t } = useStrings();
  const viewerId = useViewerId();
  const { isBlocked, ready } = useBlockedUsers();

  const who = useQuery({
    queryKey: ['person', key, 'profile'],
    queryFn: () => fetchPersonProfile(key),
    enabled: Boolean(key),
  });
  const view = usePairBalances(viewerId, key);
  const profile = who.data ?? null;

  const groups = useMemo<PairGroupRow[]>(() => {
    const byGroup = new Map(view.data.pair.groups.map((entry) => [entry.groupId, entry.lines]));
    return view.data.groups.map((meta) => ({ ...meta, lines: byGroup.get(meta.groupId) ?? [] }));
  }, [view.data]);

  const blocked = isBlocked(key);
  const masked = !ready || blocked;
  const localName = groups.find((group) => !group.otherIsGhost)?.otherName || groups[0]?.otherName;
  const realName = profile?.display_name ?? localName ?? nameParam ?? t.misc.someone;
  const title = masked ? t.misc.someone : (profile?.display_name ?? nameParam ?? localName ?? '');

  const isRealPerson = profile ? !profile.is_ghost : groups.some((group) => !group.otherIsGhost);
  const unregistered = profile
    ? profile.is_ghost
    : groups.length > 0 && groups.every((group) => group.otherIsGhost);

  const photo = useAvatarUrl(personAvatarPath(profile, masked));

  return {
    profile,
    title,
    realName,
    masked,
    blocked,
    ready,
    isRealPerson,
    unregistered,
    photo,
    groups,
    totals: currencyTotals(view.data.pair.totals),
    loading: who.isLoading || view.isLoading,
    refetch: () => {
      void who.refetch();
      view.refetch();
    },
  };
}
