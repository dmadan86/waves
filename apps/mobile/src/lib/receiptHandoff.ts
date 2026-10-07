/**
 * A picked receipt carried from one screen to the next.
 *
 * Quick expense's "Advanced" opens the full form with what was typed, and the
 * photo has to come too — but a `PickedImage` holds the bytes (base64), far
 * too big for a route param. So the sheet parks it here under a short key, the
 * key rides the route, and the screen that opens takes it back out once.
 *
 * In memory on purpose: the photo has not been uploaded yet (that happens on
 * save), and a hand-off that outlives the app was never going to land anyway.
 */

import { type PickedImage } from '@/lib/image';

const parked = new Map<string, PickedImage>();
let counter = 0;

/** Park a receipt for the next screen; returns the key to pass along. */
export function handOffReceipt(receipt: PickedImage): string {
  counter += 1;
  const key = `r${Date.now().toString(36)}${counter}`;
  parked.set(key, receipt);
  return key;
}

/** The parked receipt for `key`, left in place (safe to call in render). */
export function peekHandedReceipt(key: string | undefined): PickedImage | null {
  return key ? (parked.get(key) ?? null) : null;
}

/** Drop a parked receipt once its screen has it. */
export function dropHandedReceipt(key: string | undefined): void {
  if (key) parked.delete(key);
}
