/**
 * A plain page header for a screen that opens straight onto cards. Renders the one `HeaderBar`
 * (round back button, title, optional subtitle, one control at the far end). The body that
 * follows supplies its own gutters.
 */

import type { ReactNode } from 'react';

import { HeaderBar } from '@/components/standard/HeaderBar';

export function PlainHeader({
  title,
  subtitle,
  subtitleIcon,
  onBack,
  hideBack = false,
  trailing,
}: {
  title: string;
  /** A muted line under the title (a document's number and status). */
  subtitle?: string;
  /** A small icon before the subtitle. */
  subtitleIcon?: ReactNode;
  /** Defaults to going back one screen. */
  onBack?: () => void;
  /** A tab root has no way back: the bar is the navigation. */
  hideBack?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <HeaderBar
      title={title}
      subtitle={subtitle}
      subtitleIcon={subtitleIcon}
      onBack={onBack}
      hideBack={hideBack}
      action={trailing}
    />
  );
}
