'use client';

/**
 * Splitting one bill line by line.
 *
 * A route of its own rather than a fifth tab on the add form: an itemised bill
 * is a different shape of work — a list you build and then assign, not an
 * amount you divide — and squeezing it into the split-method row would have
 * made the common case worse to reach the rare one. The phone made the same
 * call; this is the same screen.
 */

import { useParams } from 'next/navigation';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { ItemizeForm } from '@/components/ItemizeForm';

export default function ItemizePage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params?.groupId ?? '';

  return (
    <AppFrame current={Section.Groups}>
      {({ profileId }) => <ItemizeForm groupId={groupId} myProfileId={profileId} />}
    </AppFrame>
  );
}
