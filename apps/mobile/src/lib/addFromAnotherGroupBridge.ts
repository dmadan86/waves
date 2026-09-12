/**
 * A one-shot handoff between group settings and the "add from another group"
 * screen — the same shape `contactPickerBridge` uses for the same reason.
 *
 * The new screen needs nothing from the caller except which group people are
 * being added *into* and what to do with the answer: everything it shows
 * comes off the local mirror (`useKnownContacts`), read fresh on open rather
 * than snapshotted here. A pushed route cannot hand that answer back through a
 * prop the way an inline callback could, so the caller leaves its intent here
 * first and the screen reads it once on mount, exactly as the contacts picker
 * does.
 *
 * `onPicked` deliberately takes the same `PickedContact` shape the contacts
 * bridge does. The screen this feeds hands the ticked people to group
 * settings' own `addPicked`, unchanged — the same failure-tolerant, one
 * mutation per person loop the contacts row already drives (see its comment
 * in `app/group/[id]/settings.tsx`). Nothing here invents a second way to add
 * somebody; it only offers a second way to *choose* them.
 */

import type { PickedContact } from '@/components/ContactPicker';

export interface AddFromAnotherGroupRequest {
  /** The group the ticked people would be added to. */
  readonly groupId: string;
  /** What the caller does with the people ticked, once the screen confirms. */
  readonly onPicked: (people: readonly PickedContact[]) => void;
}

let pending: AddFromAnotherGroupRequest | null = null;

/** Stash the caller's intent, then navigate to `/add-from-another-group`. */
export function requestAddFromAnotherGroup(request: AddFromAnotherGroupRequest): void {
  pending = request;
}

/**
 * Take the open request and clear it in the same step — read once on mount,
 * so nothing can carry over to the next open whether it confirms or is backed
 * out of (see `contactPickerBridge.takeContactRequest`, the same rule).
 */
export function takeAddFromAnotherGroupRequest(): AddFromAnotherGroupRequest | null {
  const request = pending;
  pending = null;
  return request;
}
