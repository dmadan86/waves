/**
 * Moving a vehicle between stores, resumable. The target gets a FRESH id (a couple space keeps a tombstone
 * for every deleted id and the tombstone wins). A small record is saved before anything is written and the
 * same target id is reused on every retry; each step is safe to repeat, the source is removed last, and the
 * record is cleared at the very end. Anything left over is finished on the next app start.
 */

export type MoveStep = 'start' | 'written' | 'rekeyed';

export interface MoveRecord {
  readonly sourceId: string;
  readonly targetId: string;
  /** null = Personal. */
  readonly sourceSpace: string | null;
  readonly targetSpace: string | null;
  readonly step: MoveStep;
  /** Name of the space it left (for "earlier expenses stay in ..."). */
  readonly from?: string;
}

export interface MoveDeps {
  readonly put: (rec: MoveRecord) => Promise<unknown>;
  readonly rekey: (from: string, to: string) => Promise<void>;
  readonly delSource: (rec: MoveRecord) => Promise<unknown>;
  /** Persist the record; `done` removes it. */
  readonly save: (rec: MoveRecord, done?: boolean) => Promise<void>;
}

/** The stored move for this source and target if there is one (a retry), else a new one with `freshId`. */
export function startMove(
  stored: readonly MoveRecord[],
  sourceId: string,
  targetSpace: string | null,
  freshId: string,
  sourceSpace: string | null,
): MoveRecord {
  return (
    stored.find((m) => m.sourceId === sourceId && m.targetSpace === targetSpace) ?? {
      sourceId,
      targetId: freshId,
      sourceSpace,
      targetSpace,
      step: 'start',
    }
  );
}

export async function runMove(start: MoveRecord, deps: MoveDeps): Promise<void> {
  let rec = start;
  const advance = async (step: MoveStep): Promise<void> => {
    rec = { ...rec, step };
    await deps.save(rec);
  };
  if (rec.step === 'start') {
    await deps.save(rec);
    await deps.put(rec);
    await advance('written');
  }
  if (rec.step === 'written') {
    await deps.rekey(rec.sourceId, rec.targetId);
    await advance('rekeyed');
  }
  await deps.delSource(rec);
  await deps.save(rec, true);
}

/** Ids whose documents must survive the orphan sweep while moves are pending. */
export const pendingMoveIds = (moves: readonly MoveRecord[]): ReadonlySet<string> =>
  new Set(moves.flatMap((m) => [m.sourceId, m.targetId]));
