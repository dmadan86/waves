import Link from 'next/link';

import { Card, Empty, PageHeader } from '@/components/ui';

/**
 * A mistyped path. Kept inside the shell — the rail is the fastest way out of
 * here, and dropping somebody onto a bare page with no navigation is a worse
 * answer than the wrong URL was.
 */
export default function NotFound() {
  return (
    <main className="page">
      <PageHeader eyebrow="Admin" title="No such page" />
      <Card bare>
        <Empty title="Nothing at that address">
          Nothing in this console answers on that path. Everything it does have is in the rail on
          the left, or start again from the <Link href="/">dashboard</Link>.
        </Empty>
      </Card>
    </main>
  );
}
