/**
 * What a sign-in screen does when a guest's Google or Apple login turns out to
 * belong to an existing Waves account.
 *
 * It used to be one more "Could not sign in. Please try again." — to somebody
 * who had done nothing wrong and whose account was right there. Now it asks:
 * switch to that account (the guest's groups are joined again, as them), or
 * stay a guest. See `lib/guestSwitch` for the switch itself.
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { OAuthMethod } from '@waves/core';

import { acceptInvite } from '@/data/api';
import { keys } from '@/data/hooks';
import { fill, useStrings } from '@/i18n';
import { IdentityTakenError, useAuth } from '@/lib/auth';
import { useDialog } from '@/lib/dialog';
import { guestJoins } from '@/lib/guestJoins';
import { switchToExistingAccount } from '@/lib/guestSwitch';
import { router } from '@/lib/navigation';
import { reportHandled } from '@/lib/observability';

/**
 * Hand it whatever a sign-in threw. Resolves `null` when this took care of it
 * (asked, and switched or stayed), or the error the screen should still show —
 * the original one, or whatever the switch itself ran into.
 */
export function useIdentityTaken(): (caught: unknown) => Promise<unknown> {
  const { session, signInInstead } = useAuth();
  const { confirm } = useDialog();
  const queryClient = useQueryClient();
  const { t } = useStrings();
  const guestId = session?.user?.id ?? null;

  return useCallback(
    async (caught: unknown): Promise<unknown> => {
      if (!(caught instanceof IdentityTakenError) || !guestId) return caught;
      const provider = caught.provider === OAuthMethod.Apple ? 'Apple' : 'Google';
      const agreed = await confirm({
        title: fill(t.signIn.accountTakenTitle, { provider }),
        body: t.signIn.accountTakenBody,
        note: t.signIn.accountTakenNote,
        confirmLabel: t.signIn.switchAccount,
        cancelLabel: t.signIn.stayGuest,
      });
      if (!agreed) return null;
      try {
        const outcome = await switchToExistingAccount({
          guestId,
          readJoins: (id) => guestJoins.read(id),
          clearJoins: (id) => guestJoins.clear(id),
          signInInstead: () => signInInstead(caught.provider),
          accept: async (token) => {
            const joined = await acceptInvite({ token, claimMemberId: null });
            // Still waiting on an admin: not a group they can open yet.
            return 'pending' in joined ? null : joined.group.id;
          },
          report: reportHandled,
        });
        if (outcome.switched) {
          await queryClient.invalidateQueries({ queryKey: keys.groups });
          router.replace(outcome.groupId ? `/group/${outcome.groupId}` : '/');
        }
        return null;
      } catch (failed) {
        return failed;
      }
    },
    [confirm, guestId, queryClient, signInInstead, t],
  );
}
