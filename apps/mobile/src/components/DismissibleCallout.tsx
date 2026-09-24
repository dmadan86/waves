import type { ComponentProps } from 'react';
import { Callout } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useDismissed } from '@/lib/dismissed';

/**
 * A `Callout` for a note that says the same thing on every visit: it carries a
 * close mark, and once closed it stays closed for this account (lib/dismissed).
 *
 * Renders nothing until the flag has been read, so a note the person already
 * closed never flashes up for a frame. Not for errors or warnings — those stay
 * a plain `Callout`.
 */
export function DismissibleCallout({
  name,
  ...props
}: Omit<ComponentProps<typeof Callout>, 'onDismiss' | 'dismissLabel'> & {
  /** Stable `<screen>.<note>` id; renaming it re-shows the note to everybody. */
  name: string;
}) {
  const { t } = useStrings();
  const { session } = useAuth();
  const { dismissed, dismiss } = useDismissed(name, session?.user.id);
  if (dismissed !== false) return null;
  return <Callout {...props} onDismiss={dismiss} dismissLabel={t.common.close} />;
}
