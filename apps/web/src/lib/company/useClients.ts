'use client';

/** React wiring for the clients and tickets pages: mirror reads and one-shot writes. */

import { useCallback, useMemo, useState } from 'react';

import { materialiseCompanyDocs, type MutationKind } from '@waves/core';

import { useStrings } from '@/i18n-context';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { NO_QUEUE, useSync } from '@/lib/sync';
import { memberName, todayIso, useCompanyView } from '@/lib/company/view';
import { buildClientsView, buildFollowUps, clientMembers, type FollowUpScope } from './clients';
import { buildTicketsView } from './tickets';

export function useCompanyPeople(groupId: string) {
  const view = useCompanyView(groupId);
  const { t } = useStrings();
  const members = useMemo(
    () =>
      clientMembers(
        view.members.map((m) => ({ ...m, profile: { display_name: memberName(m, '') || null } })),
        view.directory,
        t.company.common.someone,
      ),
    [view.members, view.directory, t.company.common.someone],
  );
  return { view, members };
}

export function useCompanyClients(groupId: string) {
  const { mirror } = useSync();
  const { profileId } = useAuth();
  const { view, members } = useCompanyPeople(groupId);
  return useMemo(
    () => ({ ...buildClientsView(mirror, groupId, members, profileId), company: view }),
    [mirror, groupId, members, profileId, view],
  );
}

export function useCompanyTickets(groupId: string) {
  const { mirror } = useSync();
  const { profileId } = useAuth();
  const { members } = useCompanyPeople(groupId);
  const clients = useCompanyClients(groupId);
  return useMemo(
    () => buildTicketsView(mirror, groupId, members, profileId, clients),
    [mirror, groupId, members, profileId, clients],
  );
}

export function useFollowUps(groupId: string, scope: FollowUpScope = 'all') {
  const { mirror } = useSync();
  const { view } = useCompanyPeople(groupId);
  const myId = view.me?.id ?? null;
  return useMemo(
    () => buildFollowUps(mirror, groupId, myId, todayIso(), scope),
    [mirror, groupId, myId, scope],
  );
}

/** One write at a time: `run` resolves true when it landed, false (with `error` set) when it did not. */
export function useCompanyWrite(groupId: string) {
  const { mutate } = useSync();
  const { t } = useStrings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (kind: MutationKind, payload: Record<string, unknown>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await mutate(kind, groupId, payload);
        return true;
      } catch (caught) {
        setError(
          friendlyError(caught, 'web.company.write', {
            fallback: t.company.common.couldNotSave,
            offline: t.errors.offline,
          }),
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [mutate, groupId, t],
  );
  return { run, busy, error };
}

/** The company's estimates and bills (owner: all, manager: their own), for client money and inquiry status. */
export function useClientDocs(groupId: string) {
  const { mirror } = useSync();
  const { view } = useCompanyPeople(groupId);
  const meId = view.me?.id ?? '';
  return useMemo(
    () =>
      view.isAdmin && meId
        ? materialiseCompanyDocs(mirror, NO_QUEUE, {
            groupId,
            currency: view.currency,
            viewerMemberId: meId,
          }).filter((d) => view.isOwner || d.createdBy === meId)
        : [],
    [mirror, groupId, view.isAdmin, view.isOwner, view.currency, meId],
  );
}
