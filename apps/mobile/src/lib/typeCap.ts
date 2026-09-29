/**
 * How far the compact, designed screens (the front door, sign-in, the phone
 * step, the intros, the device-limit gate) let the system text size grow.
 *
 * Not frozen at 1: somebody who needs larger text still gets it. Not the
 * shared `Text` component's 1.6 either, which on these fixed compositions
 * pushes the actions off the card. 1.2 is the line both hold at.
 */
export const COMPACT_TYPE_CAP = 1.2;
