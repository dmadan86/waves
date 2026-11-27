/**
 * Moving a vehicle between stores. The target gets a FRESH id: a couple space keeps a tombstone for
 * every deleted id and the tombstone wins, so moving back into a store the vehicle once left under the
 * same id would silently vanish. Order: write target, then re-key the on-device documents, then remove
 * the source, so a failure at any step never loses the vehicle.
 */

export interface MoveSource {
  readonly del: (id: string) => Promise<unknown>;
}

export async function moveVehicle(
  vehicle: { id: string },
  source: MoveSource,
  _target: unknown,
  newId: string,
  put: (oldId: string, newId: string) => Promise<unknown>,
  rekey: (oldId: string, newId: string) => Promise<void>,
): Promise<string> {
  await put(vehicle.id, newId);
  await rekey(vehicle.id, newId);
  await source.del(vehicle.id);
  return newId;
}
