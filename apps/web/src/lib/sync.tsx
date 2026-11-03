'use client';

/**
 * The browser's copy of the account, filled by the same `sync` edge function the
 * phone uses, so every company selector in @waves/core reads the same rows here.
 *
 * Online-only: there is no offline queue. A write is POSTed at once and either
 * lands or throws, so a page can say "could not save" instead of pretending.
 * The mirror lives in memory for the tab; a reload pulls again.
 *
 * shortcut: full-account pull per page load, add a sessionStorage cursor cache when slow
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  emptyMirror,
  purgeCompanyInvisible,
  reconcile,
  type MirrorState,
  type MutationKind,
  type QueuedMutation,
  type SyncChange,
} from '@waves/core';
import { WavesApiError } from '@waves/api-client';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/waves';

/** The phone overlays queued writes on the mirror; the web has none, so ports pass this. */
export const NO_QUEUE: readonly QueuedMutation[] = [];

export interface SyncResponse {
  outcomes: {
    clientMutationId: string;
    status: 'applied' | 'duplicate' | 'rejected';
    code?: string;
    message?: string;
  }[];
  changes: SyncChange[];
  cursors: Record<string, number>;
  hasMore?: boolean;
  memberOf?: string[];
  companyVisible?: Record<string, string[]>;
  calendarVisible?: Record<
    string,
    { dates: string[]; events: string[]; clients?: string[]; tickets?: string[] }
  >;
  serverTime?: string;
}

interface SyncMutation {
  clientMutationId: string;
  kind: MutationKind;
  groupId: string;
  clientCreatedAt: string;
  payload: unknown;
}

/** supabase-js hands back the raw Response on a non-2xx; read the JSON body it carries. */
async function describeInvokeError(error: unknown): Promise<WavesApiError> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { code?: string; message?: string };
      if (body.message) return new WavesApiError(body.message, body.code);
    } catch {
      // not JSON: fall through
    }
  }
  return new WavesApiError(error instanceof Error ? error.message : 'Sync failed');
}

/** One round trip. `cursors` `{}` pulls everything the caller can see. */
export async function postSync(
  cursors: Readonly<Record<string, number>>,
  mutations: readonly SyncMutation[] = [],
): Promise<SyncResponse> {
  const { data, error } = await supabase.functions.invoke('sync', {
    body: { deviceId: 'web', mutations, cursors },
  });
  if (error) throw await describeInvokeError(error);
  const response = data as SyncResponse;
  return {
    ...response,
    outcomes: response.outcomes ?? [],
    changes: response.changes ?? [],
    cursors: response.cursors ?? {},
  };
}

function fold(mirror: MirrorState, response: SyncResponse): MirrorState {
  const merged = reconcile(mirror, response.changes);
  // The server's cursors are authoritative: they advance past rows we may not read.
  return {
    cursors: { ...merged.state.cursors, ...response.cursors },
    tables: merged.state.tables,
  };
}

function sameCursors(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>) {
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every((key) => a[key] === b[key]);
}

/** Drop cached rows the server says this caller may no longer read (an employee moved teams). */
function purge(mirror: MirrorState, response: SyncResponse): MirrorState {
  if (!response.companyVisible && !response.calendarVisible) return mirror;
  return purgeCompanyInvisible(mirror, response.companyVisible ?? {}, response.calendarVisible)
    .state;
}

/** Keep asking while the server says a table was cut at its page size. */
async function drain(
  mirror: MirrorState,
  first: SyncResponse | null,
  mutations: readonly SyncMutation[] = [],
): Promise<MirrorState> {
  let state = mirror;
  let response = first ?? (await postSync(state.cursors, mutations));
  while (true) {
    const before = state.cursors;
    state = fold(state, response);
    if (!response.hasMore || sameCursors(before, state.cursors)) break;
    response = await postSync(state.cursors);
  }
  return purge(state, response);
}

/** Pull the account from `mirror`'s cursors until the server has nothing more. */
export function pull(mirror: MirrorState = emptyMirror()): Promise<MirrorState> {
  return drain(mirror, null);
}

/**
 * Apply one mutation now. Resolves with the mirror after the server's answer;
 * throws a WavesApiError carrying the server's `code` when it refuses.
 */
export async function send(
  mirror: MirrorState,
  kind: MutationKind,
  groupId: string,
  payload: unknown,
  /** Called with the mirror after the answer is folded in, before a rejection throws. */
  onFolded?: (mirror: MirrorState) => void,
): Promise<MirrorState> {
  const mutation: SyncMutation = {
    clientMutationId: crypto.randomUUID(),
    kind,
    groupId,
    clientCreatedAt: new Date().toISOString(),
    payload,
  };
  const response = await postSync(mirror.cursors, [mutation]);
  const outcome = response.outcomes.find((o) => o.clientMutationId === mutation.clientMutationId);
  if (outcome?.status === 'rejected') {
    // Other people's rows in the same answer are still true: keep them.
    onFolded?.(fold(mirror, response));
    throw new WavesApiError(
      outcome.message ?? 'The server refused this change',
      outcome.code ?? 'VALIDATION_FAILED',
    );
  }
  return drain(mirror, response);
}

interface SyncValue {
  mirror: MirrorState;
  /** True once the first full pull has finished. */
  hydrated: boolean;
  error: string | null;
  mutate: (kind: MutationKind, groupId: string, payload: Record<string, unknown>) => Promise<void>;
  refresh: () => Promise<void>;
}

interface Internal extends SyncValue {
  start: () => void;
}

const SyncContext = createContext<Internal | null>(null);

/** Keyed by account: a different person remounts the state, so rows never leak across sign-ins. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { profileId } = useAuth();
  return (
    <AccountSync key={profileId ?? 'signed-out'} profileId={profileId}>
      {children}
    </AccountSync>
  );
}

function AccountSync({ profileId, children }: { profileId: string | null; children: ReactNode }) {
  const [mirror, setMirror] = useState<MirrorState>(emptyMirror);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wanted, setWanted] = useState(false);
  const latest = useRef<MirrorState>(mirror);
  // Writes and pulls run one at a time so two answers never fold over each other.
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const commit = useCallback((next: MirrorState) => {
    latest.current = next;
    setMirror(next);
  }, []);

  const serial = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(work, work);
    chain.current = run.catch(() => undefined);
    return run;
  }, []);

  const refresh = useCallback(
    () =>
      serial(async () => {
        try {
          commit(await pull(latest.current));
          setHydrated(true);
          setError(null);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Sync failed');
          throw caught;
        }
      }),
    [commit, serial],
  );

  const mutate = useCallback(
    (kind: MutationKind, groupId: string, payload: Record<string, unknown>) =>
      serial(async () => {
        commit(await send(latest.current, kind, groupId, payload, commit));
      }),
    [commit, serial],
  );

  useEffect(() => {
    if (wanted && profileId) void refresh().catch(() => undefined);
  }, [wanted, profileId, refresh]);

  const start = useCallback(() => setWanted(true), []);
  const value = useMemo<Internal>(
    () => ({ mirror, hydrated, error, mutate, refresh, start }),
    [mirror, hydrated, error, mutate, refresh, start],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/** The mirror and its writers. The first call in a tab starts the pull, so non-company pages cost nothing. */
export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside SyncProvider');
  const { start } = value;
  useEffect(() => start(), [start]);
  return value;
}
