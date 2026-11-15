import { setOverlayBusy } from './firstRun';

let owner: symbol | null = null;

export function claimAdSheet(id: symbol): boolean {
  if (adSheetTaken(id)) return false;
  owner = id;
  setOverlayBusy('ad', true);
  return true;
}

export function releaseAdSheet(id: symbol): void {
  if (owner === id) {
    owner = null;
    setOverlayBusy('ad', false);
  }
}

export function adSheetTaken(id: symbol): boolean {
  return owner !== null && owner !== id;
}

export function resetAdSheetLock(): void {
  owner = null;
  setOverlayBusy('ad', false);
}
