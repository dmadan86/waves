/** On app start, finishes any vehicle move that was left half done (see lib/vehicleMove). Renders nothing. */
import { useEffect, useRef, useState } from 'react';

import { useRentalStore } from '@/data/personalWealth';
import { resumeMove } from '@/data/vehicles';
import { readMoves } from '@/lib/propertyDocs';
import type { MoveRecord } from '@/lib/vehicleMove';

function ResumeOne({ rec }: { rec: MoveRecord }) {
  const source = useRentalStore(rec.sourceSpace ?? undefined);
  const target = useRentalStore(rec.targetSpace ?? undefined);
  const tried = useRef(false);
  // Wait until the source store has loaded its records, so "not found" really means gone.
  const ready = source.records.length > 0 || rec.step !== 'start';
  useEffect(() => {
    if (tried.current || !ready) return;
    tried.current = true;
    void resumeMove(rec, source, target).catch(() => {});
  }, [ready, rec, source, target]);
  return null;
}

export function ResumeVehicleMoves() {
  const [moves, setMoves] = useState<MoveRecord[]>([]);
  useEffect(() => {
    void readMoves().then(setMoves);
  }, []);
  return (
    <>
      {moves.map((m) => (
        <ResumeOne key={`${m.sourceId}:${m.targetSpace ?? ''}`} rec={m} />
      ))}
    </>
  );
}
