/**
 * A one-shot handoff between the disclosure screen and the paste screen.
 *
 * The messages Android hands back cannot ride in route params: a navigation
 * param is a string in a URL, it is logged by the router in development, and it
 * would put bank message bodies into a place nobody audits. They cannot live in
 * React state either, because the screen that asked for them is off-screen
 * while the disclosure screen is up.
 *
 * So, the same module-singleton pattern `contactPickerBridge` uses — with one
 * difference that matters here: this holds message bodies, so it is emptied the
 * instant it is read (`takeReadMessages` reads and clears in one step) and
 * again on `clearReadMessages` when the disclosure screen is abandoned. Nothing
 * it holds is ever written to disk, and nothing it holds outlives the
 * navigation that carries it back.
 */

import type { SmsMessage } from '@waves/core';

let pending: SmsMessage[] | null = null;

/** Leave the read messages for the screen that asked, then `router.back()`. */
export function offerReadMessages(messages: readonly SmsMessage[]): void {
  pending = [...messages];
}

/**
 * Take what was read and clear it in the same step, so a second render — or a
 * later, unrelated visit to the paste screen — can never pick the same bodies
 * up again.
 */
export function takeReadMessages(): SmsMessage[] | null {
  const messages = pending;
  pending = null;
  return messages;
}

/** Drop anything held without reading it. */
export function clearReadMessages(): void {
  pending = null;
}
