'use client';

/**
 * `/join/<token>` — an invite with the token in the path.
 *
 * The screen itself is `JoinFlow`, shared with `/join#<token>`, which is the
 * shape the app's own durable link takes. Two routes, one arrival.
 */

import { useParams } from 'next/navigation';

import { JoinFlow } from '@/components/JoinFlow';

export default function JoinTokenPage() {
  const params = useParams<{ token: string }>();
  return <JoinFlow token={params.token} />;
}
