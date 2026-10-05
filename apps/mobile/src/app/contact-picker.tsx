/**
 * The full-screen contact picker.
 *
 * Adding people to a group used to open the address book inline — a tall list
 * folded into the middle of the new-group and members forms. A thousand-name
 * book needs the whole screen (the alphabet rail needs somewhere to aim), so it
 * lives here as its own route now, and the form that wanted it navigates in.
 *
 * A pushed route cannot return a value the way an inline callback did, so the
 * caller leaves its intent in `contactPickerBridge` first — who is already
 * picked, and what to do with the answer — and this screen reads it once on
 * open. Confirming hands the ticked people back through that callback and
 * closes; backing out without confirming drops the request untouched.
 *
 * The hero wears the same scenic scene Home and Personal do (`HeroScene`), cut
 * down to one row (the back button inline with the title) and a single small
 * line under it — because this is a picker, not a dashboard: the scene is
 * here to say "you are still inside Waves", not to carry a balance or a
 * greeting. The search field rides up over its foot the way Home's balance
 * card and the new-group form's first card already do (a negative margin
 * equal to the scene's own overlap, not a second idea about how to float a
 * card over a landscape) — kept no bigger than the sliver of mountain the
 * header leaves under its own text, so the ride never reaches the subtitle.
 * Everything below the search field — the filter pills, the list, the
 * confirm bar — is `ContactPicker`'s own `compact` dress, so the behaviour
 * (search, the recent section, the escape row, permissions) is exactly what
 * every other picker in the app already has.
 */

import { useEffect, useState } from 'react';

import { useStrings } from '@/i18n';

import { type PickedContact } from '@/components/ContactPicker';
import { ContactPickerScene } from '@/components/ContactPickerScene';
import { takeContactRequest } from '@/lib/contactPickerBridge';
import { router } from '@/lib/navigation';

export default function ContactPickerScreen(): React.JSX.Element {
  const { t } = useStrings();

  // Taken once on mount — this captures the request and clears the bridge in
  // one step, so the route owns it outright and no re-render or later open can
  // see a stale request. Nothing else clears it; this screen is the sole owner.
  const [request] = useState(() => takeContactRequest());

  // Opened with no pending request (a deep link, a stray navigation) has
  // nothing to pick for — close rather than show a picker that answers nobody.
  useEffect(() => {
    if (!request) router.back();
  }, [request]);

  const confirm = (people: readonly PickedContact[]): void => {
    request?.onPicked(people);
    router.back();
  };

  return (
    <ContactPickerScene
      onConfirm={confirm}
      confirmVerb={t.add}
      initialSelected={request?.initial}
      existing={request?.existing}
    />
  );
}
