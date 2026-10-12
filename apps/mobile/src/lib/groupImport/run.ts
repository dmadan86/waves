/**
 * Writing a reviewed import into a group.
 *
 * The write itself is `importIntoGroup` (250 rows a call, one batch id); this is
 * the job around it that the background store runs. It is handed the api as a
 * parameter, so what it promises can be tested without a network: the batch id
 * and every row id arrive already chosen (a retry replays instead of duplicating),
 * progress is reported as chunks land, and the group's mirror is pulled before
 * the job says it is done, so the rows are on screen the moment the banner turns
 * to a check.
 */

import type { ImportBatchResult, ImportProgress, ImportSource } from '@/data/api';

import type { ImportPayload } from './review';

export interface GroupImportJobInput {
  groupId: string;
  batchId: string;
  source: ImportSource;
  payload: ImportPayload;
  /** Rows per call; the server accepts at most 500. */
  chunkSize?: number;
}

export interface GroupImportJobDeps {
  write: (input: {
    groupId: string;
    batchId: string;
    source: ImportSource;
    people: ImportPayload['people'];
    expenses: ImportPayload['expenses'];
    settlements: ImportPayload['settlements'];
    chunkSize?: number;
    onChunk?: (progress: ImportProgress) => void;
  }) => Promise<ImportBatchResult>;
  /** Pull the group into the local mirror. */
  pull: (groupId: string) => Promise<void>;
  report: (done: number, total: number) => void;
}

export interface GroupImportJobResult {
  groupId: string;
  batchId: string;
  expenses: number;
  settlements: number;
  ghosts: number;
}

/** What the import source is called on the server, from the file the rows came from. */
export function importSourceFor(
  layoutKind: 'splitwise' | 'waves_csv' | 'generic',
  fileKind: 'csv' | 'xlsx',
): ImportSource {
  if (layoutKind === 'splitwise') return 'splitwise';
  if (layoutKind === 'waves_csv') return 'waves_csv';
  return fileKind === 'xlsx' ? 'xlsx' : 'csv';
}

/** Rows to write, expenses and settlements together. */
export function rowTotal(payload: ImportPayload): number {
  return payload.expenses.length + payload.settlements.length;
}

export async function runGroupImport(
  input: GroupImportJobInput,
  deps: GroupImportJobDeps,
): Promise<GroupImportJobResult> {
  const total = rowTotal(input.payload);
  deps.report(0, total);
  const result = await deps.write({
    groupId: input.groupId,
    batchId: input.batchId,
    source: input.source,
    people: input.payload.people,
    expenses: input.payload.expenses,
    settlements: input.payload.settlements,
    chunkSize: input.chunkSize,
    onChunk: (progress) => deps.report(progress.done, progress.total),
  });

  // The rows are on the server; the screen reads the local mirror. A failed pull
  // is not a failed import, and the poll will bring them in a moment later.
  try {
    await deps.pull(input.groupId);
  } catch {
    // Nothing to undo and nothing to tell the person.
  }

  return {
    groupId: input.groupId,
    batchId: input.batchId,
    expenses: result.totals.expenses,
    settlements: result.totals.settlements,
    ghosts: result.totals.ghosts,
  };
}
