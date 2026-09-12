import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import { Badge, Card, Empty, Field, Lede, Outcome, PageHeader } from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import { appReleases, saveAppRelease, type AppReleaseRow } from '@/lib/data';

export const dynamic = 'force-dynamic';

const STORE: Record<string, string> = { ios: 'App Store', android: 'Google Play' };

/**
 * The version policy, per store.
 *
 * This is the single sharpest lever in the database and it had no screen at
 * all: raising a minimum version meant a SQL console, which is not a thing
 * anybody wants to be doing at the moment they need it — the moment they need
 * it is a bad build in the wild.
 *
 * The screen is deliberately blunt about what the minimum does. It is not a
 * recommendation and it is not a nag: the app checks it before sign-in, so
 * every install below it is locked out of the product until the store has the
 * newer build. Hence the warning banner when a minimum is already at the
 * latest — that is the state where a single mistaken publish strands
 * everybody — and hence the refusal, in the data layer and again in the
 * database, of a minimum above the latest.
 */
export default async function Releases({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const rows = await appReleases();

  async function save(formData: FormData) {
    'use server';

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await saveAppRelease({
        platform: String(formData.get('platform') ?? ''),
        latestVersion: String(formData.get('latest') ?? ''),
        minimumVersion: String(formData.get('minimum') ?? ''),
        storeUrl: String(formData.get('store_url') ?? ''),
        message: String(formData.get('message') ?? ''),
        confirmMinimum: String(formData.get('confirm_minimum') ?? ''),
      });
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/releases?error=${encodeURIComponent(failure)}`);
    revalidatePath('/releases');
    redirect('/releases?saved=1');
  }

  return (
    <main className="page">
      <PageHeader eyebrow="Configuration" title="Releases" />
      <Outcome error={error} done={saved ? 'Saved.' : undefined} />

      <Lede>
        What each store is running and what the app will refuse to run below.{' '}
        <strong>Minimum is a lockout, not a nudge</strong> — it is checked before anybody signs in,
        so every install under it is out of the product until that store has the newer build.
        Latest, by contrast, is only what the app compares against to say &ldquo;there is an
        update&rdquo;. Both take effect on the next launch; there is nothing to deploy. Raising a
        minimum asks you to type the number twice — the accident that strands everybody is not a
        minimum above the latest (the database refuses that) but both numbers typed above every
        build that exists.
      </Lede>

      {rows.length === 0 ? (
        <Card bare>
          <Empty title="No release policy" migration="20260904000000_waves_baseline">
            Nothing in <code>app_releases</code>. The app treats a missing row as &ldquo;no
            minimum&rdquo;, so nobody is locked out — but nobody is told about updates either.
          </Empty>
        </Card>
      ) : (
        <div className="cols-2">
          {rows.map((row) => (
            <ReleaseCard key={row.platform} row={row} save={save} />
          ))}
        </div>
      )}
    </main>
  );
}

function ReleaseCard({
  row,
  save,
}: {
  row: AppReleaseRow;
  save: (formData: FormData) => Promise<void>;
}) {
  const gated = row.minimum_version === row.latest_version;

  return (
    <Card
      title={STORE[row.platform] ?? row.platform}
      eyebrow={row.platform}
      actions={
        gated ? (
          <Badge tone="warn">Forced upgrade</Badge>
        ) : (
          <Badge tone="ok">Older builds allowed</Badge>
        )
      }
      note={
        <>
          Last changed{' '}
          {new Date(row.updated_at).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
          .{' '}
          {gated
            ? `Everybody below ${row.latest_version} is locked out right now.`
            : `Builds from ${row.minimum_version} up are allowed in.`}
        </>
      }
    >
      <form action={save} className="form">
        <CsrfField />
        <input type="hidden" name="platform" value={row.platform} />

        <Field label="Latest" hint="what the store has">
          <input
            type="text"
            name="latest"
            defaultValue={row.latest_version}
            pattern="[0-9]+(\.[0-9]+){0,3}"
            required
            size={10}
            aria-label={`Latest ${row.platform} version`}
          />
        </Field>

        <Field label="Minimum" hint="below this, locked out">
          <input
            type="text"
            name="minimum"
            defaultValue={row.minimum_version}
            pattern="[0-9]+(\.[0-9]+){0,3}"
            required
            size={10}
            aria-label={`Minimum allowed ${row.platform} version`}
          />
        </Field>

        {/* The guard against the accident the CHECK cannot see: raising both
            numbers together. `minimum = latest = 11.4.0` for a build called
            1.4.0 passes every ordering test and strands the entire install
            base, because the store has nothing above it to install. Typing the
            number a second time is a dull hurdle placed at the one moment
            somebody is moving fast. Lowering a minimum needs nothing — it
            cannot lock anybody out, and an operator undoing a mistake at 2am
            should not have to type anything twice. */}
        <Field label="Confirm minimum" hint="only needed when raising it">
          <input
            type="text"
            name="confirm_minimum"
            pattern="[0-9]+(\.[0-9]+){0,3}"
            size={10}
            placeholder={row.minimum_version}
            aria-label={`Retype the new minimum ${row.platform} version to confirm`}
          />
        </Field>

        <Field label="Store link" full>
          <input
            type="url"
            name="store_url"
            defaultValue={row.store_url}
            required
            aria-label={`${row.platform} store link`}
          />
        </Field>

        <Field label="Upgrade message" hint="blank for the app's own wording" full>
          <input
            type="text"
            name="message"
            defaultValue={row.message ?? ''}
            maxLength={300}
            placeholder="Update to keep syncing."
            aria-label={`Upgrade message shown on ${row.platform}`}
          />
        </Field>

        <button type="submit" className="btn">
          {Icon.save}
          <span>Save {row.platform}</span>
        </button>
      </form>
    </Card>
  );
}
