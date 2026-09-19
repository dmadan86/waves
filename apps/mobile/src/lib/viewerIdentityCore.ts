/**
 * Who the person holding the phone is, as plain values.
 *
 * Kept apart from the hook in `viewerIdentity` for the same reason
 * `destinationPickerState` is kept apart from the picker: everything here is
 * ordinary JavaScript, so it can be tested without a session, a provider tree
 * or React Native being loadable at all.
 *
 * `||` throughout, never `??`. A cleared avatar column, or a provider that
 * sends an empty string, means "no photo" — it has to fall through to the next
 * source rather than be handed on as a blank URL that resolves to nothing.
 */

export interface ViewerIdentity {
  /** Never blank: falls back to the same "You" the save path already uses. */
  name: string;
  /** The profile photo, the provider's photo, or null for initials. */
  avatarUrl: string | null;
  /**
   * Whether this is a real account rather than a guest.
   *
   * Carried alongside because the two questions are always asked together: a
   * guest has no private ledger to file anything in, and no name worth showing
   * in place of one. Callers that only need the gate should keep using
   * `usePersonalOffered` — this is for the ones that need the face as well.
   */
  isGuest: boolean;
}

export function viewerIdentityFrom(
  profile: { display_name?: string | null; avatar_url?: string | null } | null | undefined,
  /** `user_metadata` — untyped JSON from whichever provider signed this in. */
  metadata: { avatar_url?: unknown; picture?: unknown } | null | undefined,
  fallbackName: string,
): Omit<ViewerIdentity, 'isGuest'> {
  const oauthAvatar =
    (typeof metadata?.avatar_url === 'string' ? metadata.avatar_url : '') ||
    (typeof metadata?.picture === 'string' ? metadata.picture : '') ||
    null;

  return {
    name: profile?.display_name?.trim() || fallbackName,
    avatarUrl: profile?.avatar_url || oauthAvatar,
  };
}
