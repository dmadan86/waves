import { PageSkeleton } from '@/components/ui';

/**
 * The root loading state, which every route inherits unless it declares its
 * own.
 *
 * Every page in this console is `force-dynamic` and every one of them opens
 * with six parallel round trips to a database in another region, so the gap
 * between clicking a rail item and seeing anything is real and was, until now,
 * entirely blank — the previous page just sat there. This is the Suspense
 * fallback that replaces that: shaped like the page behind it, so the layout
 * does not jump when the numbers land.
 */
export default function Loading() {
  return <PageSkeleton />;
}
