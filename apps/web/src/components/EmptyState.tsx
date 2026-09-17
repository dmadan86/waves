/**
 * A page with nothing on it yet.
 *
 * Three screens used to answer an empty list with one grey sentence, which
 * reads the same as a page that failed — and on a new account, which is every
 * account once, that grey sentence was the whole product. This gives the state
 * a shape: a mark, a line that says what is missing, a line that says why, and
 * where there is one useful next step, the step itself.
 *
 * It is deliberately not an illustration. The mark is the same icon the
 * destination wears in the rail, so an empty Groups page still looks like
 * Groups.
 */

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  Icon,
  title,
  body,
  action,
}: {
  Icon: LucideIcon;
  title: string;
  body?: string;
  /** The one step worth offering here, if there is one. */
  action?: { label: string; href: string };
}) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden>
        <Icon size={22} strokeWidth={1.75} />
      </span>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action ? (
        <Link className="btn" href={action.href} style={{ marginTop: 6 }}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
