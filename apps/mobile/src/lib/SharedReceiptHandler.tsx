/**
 * Opens add-expense with a photo another app shared to Waves.
 *
 * Mounted once, inside the auth provider. A share is read from the native side
 * at launch, on every return to the foreground (iOS delivers this way, and it
 * catches an Android share that raced the first read) and live while the app is
 * running (Android). It waits for a signed-in session, so a share made before
 * sign-in is routed right after it, and is routed once: the delivery id is
 * remembered and the native copy cleared.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useGroups } from '@/data/hooks';
import { useAuth } from '@/lib/auth';
import { receiptFromFile } from '@/lib/image';
import { router } from '@/lib/navigation';
import { handOffReceipt } from '@/lib/receiptHandoff';
import { loadRecentDestinations, recentDestinations } from '@/lib/recentDestinations';
import { shareRoute } from '@/lib/sharedReceipt';
import { addShareListener, clearShare, getInitialShare } from '../../modules/waves-share';
import { createShareDedupe, type IncomingShare } from '../../modules/waves-share/incoming';

const dedupe = createShareDedupe();

export function SharedReceiptHandler() {
  const { session, loading } = useAuth();
  const groups = useGroups();
  const ready = !loading && Boolean(session);
  const groupIds = useRef<ReadonlySet<string>>(new Set());
  const rows = groups.data;
  useEffect(() => {
    groupIds.current = new Set((rows ?? []).map((group) => group.id));
  }, [rows]);
  const waiting = useRef<IncomingShare | null>(null);
  const busy = useRef(false);

  const route = useCallback(async (share: IncomingShare): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!dedupe.accept(share.id)) return;
      waiting.current = null;
      try {
        const image = await receiptFromFile(share.uri);
        await loadRecentDestinations();
        const key = handOffReceipt(image);
        router.push(
          shareRoute({
            receiptKey: key,
            recents: recentDestinations(),
            groupIds: groupIds.current,
          }) as never,
        );
      } catch {
        // An unreadable image is dropped; nothing to retry.
      }
      await clearShare(share.id);
    } finally {
      busy.current = false;
    }
  }, []);

  const take = useCallback(
    (share: IncomingShare | null): void => {
      if (!share) return;
      // Not signed in yet: keep it until there is a session.
      if (!ready) {
        waiting.current = share;
        return;
      }
      void route(share);
    },
    [ready, route],
  );

  // Cold start, and a share that was waiting for sign-in.
  useEffect(() => {
    if (!ready) return;
    const held = waiting.current;
    if (held) void route(held);
    void getInitialShare().then(take);
  }, [ready, route, take]);

  // Live shares and returns to the foreground.
  useEffect(() => {
    const stop = addShareListener(take);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getInitialShare().then(take);
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [take]);

  return null;
}
