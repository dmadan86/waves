/**
 * The shelf, and what is on this person's own shelf.
 *
 * Two different kinds of data, deliberately read two different ways:
 *
 * - **The catalogue is a network read.** What we publish is not the user's data,
 *   and mirroring it would make every visit an offline read of a stale shelf.
 *   Offline, the shelf is empty and says so — which is honest, and nothing else
 *   in the app breaks for want of it.
 * - **Their installs ride the mirror**, like every other personal row, so a pack
 *   installed on a plane shows as installed straight away.
 *
 * Installing writes two things through the ordinary queue: the tags, as
 * `tag.create` mutations, and one `pack.install` row saying where they came
 * from. Nothing here is privileged, which is why it works with no signal.
 */

import { useMemo } from 'react';
import { randomUUID } from 'expo-crypto';
import { useMutation, useQuery } from '@tanstack/react-query';

import {
  installPlan,
  materialisePackInstalls,
  MutationKind,
  packInstallsScope,
  parsePack,
  categoryTagsScope,
  type Pack,
} from '@waves/core';

import { backend } from '@/lib/backend';
import { useAuth } from '@/lib/auth';
import { useCategoryTags } from '@/data/hooks';
import { useSync } from '@/sync';

/** A published pack, as the shelf shows it. */
export interface ShelfPack extends Pack {
  readonly installCount: number;
}

/**
 * Every published pack.
 *
 * `parsePack` runs again here, on what the server sent. The console validated
 * before publishing and RLS limits this to what we published — and a client that
 * trusts both of those and renders whatever arrives is a client that draws a
 * blank box the first time something upstream goes wrong. A pack that does not
 * parse is dropped rather than shown broken.
 */
export async function fetchPacks(): Promise<ShelfPack[]> {
  const { data, error } = await backend
    .from('packs')
    .select('id, slug, title, summary, entries, version, install_count')
    .order('install_count', { ascending: false });
  if (error) throw error;

  const out: ShelfPack[] = [];
  for (const row of data ?? []) {
    const record = row as Record<string, unknown>;
    const pack = parsePack({
      id: record.id,
      slug: record.slug,
      title: record.title,
      summary: record.summary,
      entries: record.entries,
      version: record.version,
    });
    if (!pack) continue;
    out.push({ ...pack, installCount: Number(record.install_count ?? 0) });
  }
  return out;
}

export function usePacks() {
  return useQuery({ queryKey: ['packs'], queryFn: fetchPacks });
}

export interface InstalledPack {
  readonly installId: string;
  readonly packId: string;
  readonly version: number;
  readonly pending: boolean;
}

/** What this person has installed, read local-first like every personal row. */
export function useInstalledPacks(): InstalledPack[] {
  const { mirror, queue } = useSync();
  const { session } = useAuth();
  const ownerId = session?.user?.id ?? null;

  return useMemo(() => {
    if (!ownerId) return [];
    return materialisePackInstalls(mirror, queue, { ownerId }).map((row) => ({
      installId: row.id,
      packId: row.pack_id,
      version: row.version,
      pending: row.pending === true,
    }));
  }, [mirror, queue, ownerId]);
}

/**
 * Install a pack: its categories, then the record of where they came from.
 *
 * The tags go first on purpose. If the run is interrupted between the two, the
 * person has the categories and no install record — the shelf offers the pack
 * again, and installing it a second time writes nothing new, because every tag
 * id is derived from the pack and the entry. The other order would leave a pack
 * marked installed whose categories never arrived, which nothing would correct.
 */
export function useInstallPack() {
  const { mutate } = useSync();
  const { session } = useAuth();
  const tags = useCategoryTags();

  return useMutation({
    mutationFn: async (pack: Pack): Promise<number> => {
      const ownerId = session?.user?.id;
      if (!ownerId) throw new Error('Sign in first');

      const plan = installPlan(pack, tags.data);
      for (const payload of plan.create) {
        await mutate(MutationKind.TagCreate, categoryTagsScope(ownerId), {
          ...payload,
          packId: pack.id,
        });
      }
      await mutate(MutationKind.PackInstall, packInstallsScope(ownerId), {
        installId: randomUUID(),
        packId: pack.id,
        version: pack.version,
      });
      return plan.create.length;
    },
  });
}

/** Uninstall: the record goes, the categories stay. */
export function useUninstallPack() {
  const { mutate } = useSync();
  const { session } = useAuth();

  return useMutation({
    mutationFn: async (installId: string): Promise<void> => {
      const ownerId = session?.user?.id;
      if (!ownerId) throw new Error('Sign in first');
      await mutate(MutationKind.PackUninstall, packInstallsScope(ownerId), { installId });
    },
  });
}

/** Ask for a pack that does not exist yet — the other half of "we author them,
 *  others ask". One row, no authoring surface, nothing shown to anybody else. */
export function useRequestPack() {
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (body: string): Promise<void> => {
      const requesterId = session?.user?.id;
      if (!requesterId) throw new Error('Sign in first');
      const { error } = await backend
        .from('pack_requests')
        .insert({ requester_id: requesterId, body: body.trim().slice(0, 500) });
      if (error) throw error;
    },
  });
}
