'use client';

import { useEffect } from 'react';

import { Icon } from '@/components/icons';

/**
 * What a page shows when its server component threw.
 *
 * `data.ts` throws with the failing function's name in the message — "reading
 * app_config failed: …" — and that is exactly the sentence somebody debugging
 * a console at 2am needs. So it is shown, rather than swallowed into "Something
 * went wrong": the audience here is one operator with a database password, not
 * the public, and there is nothing to leak to. It is still labelled clearly as
 * the raw error so it is never mistaken for a message written for a reader.
 *
 * A Client Component because that is what an App Router error boundary is.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // The message is on screen; the stack only exists in the console.
    console.error(error);
  }, [error]);

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Something failed</div>
          <h1>This page could not be loaded</h1>
        </div>
      </header>

      <div className="banner banner-danger" role="alert">
        {Icon.alert}
        <div>
          <strong>The database call did not come back.</strong>
          <p style={{ margin: '0.5rem 0 0' }}>
            <code>{error.message}</code>
          </p>
        </div>
      </div>

      <p className="lede">
        The usual causes, in order of likelihood: the migration that creates what this page reads is
        not deployed to this project; <code>SUPABASE_URL</code> or{' '}
        <code>SUPABASE_SERVICE_ROLE_KEY</code> is missing or wrong; or the project is asleep.
        Nothing was written — every page here reads before it offers to change anything.
      </p>

      <button type="button" className="btn" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
