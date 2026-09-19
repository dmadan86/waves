/**
 * Who the person holding the phone is, as a name and a face.
 *
 * Written for the destination pickers, where "this expense is mine" stopped
 * being the words *Just me* and became the reader's own portrait and name — a
 * shortcut you recognise rather than one you read. Anything else that has to
 * show the viewer as one of several possible destinations should come here too,
 * so those surfaces cannot drift into disagreeing about what somebody is called.
 *
 * The derivation itself is not new: `settings/account` and `(tabs)/profile` each
 * carry their own copy, and one of them says so in a comment. Those are left
 * where they are — one has a change in flight — but this is the copy new code
 * should use, and the one they should fold into when that settles.
 *
 * The rules live in `viewerIdentityCore`, which imports nothing, so they can be
 * tested without React Native.
 */

import { useAuth } from '@/lib/auth';
import { viewerIdentityFrom, type ViewerIdentity } from '@/lib/viewerIdentityCore';
import { useStrings } from '@/i18n';

export type { ViewerIdentity };

export function useViewerIdentity(): ViewerIdentity {
  const { profile, session, isGuest } = useAuth();
  const { t } = useStrings();

  return {
    ...viewerIdentityFrom(profile, session?.user?.user_metadata, t.account.you),
    isGuest,
  };
}
