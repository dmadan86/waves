import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import {
  Badge,
  Banner,
  Card,
  Check,
  Empty,
  Field,
  Lede,
  Outcome,
  PageHeader,
  TableScroll,
} from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import {
  rateLimitEnabled,
  rateLimitRules,
  saveRateLimitRule,
  setRateLimitEnabled,
} from '@/lib/data';

export const dynamic = 'force-dynamic';

/** Seconds rendered as the unit an operator thinks in. */
function windowLabel(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/** The buckets the code actually consults. Anything else here is inert. */
const KNOWN = [
  'sync',
  'expense-write',
  'export-data',
  'fx-rate',
  'invite-mint',
  'invite-accept',
  'receipt-parse',
];

export default async function RateLimits({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const [enabled, rules] = await Promise.all([rateLimitEnabled(), rateLimitRules()]);

  async function toggleMaster(formData: FormData) {
    'use server';
    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await setRateLimitEnabled(formData.get('enabled') === 'on');
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }
    if (failure) redirect(`/rate-limits?error=${encodeURIComponent(failure)}`);
    revalidatePath('/rate-limits');
    redirect('/rate-limits?saved=1');
  }

  async function saveRule(formData: FormData) {
    'use server';
    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await saveRateLimitRule({
        bucket: String(formData.get('bucket') ?? '').trim(),
        enabled: formData.get('enabled') === 'on',
        maxCalls: Number(formData.get('max_calls') ?? 0),
        windowSeconds: Number(formData.get('window_seconds') ?? 0),
      });
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }
    if (failure) redirect(`/rate-limits?error=${encodeURIComponent(failure)}`);
    revalidatePath('/rate-limits');
    redirect('/rate-limits?saved=1');
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="Configuration"
        title="Rate limits"
        actions={
          enabled ? <Badge tone="ok">Limiting on</Badge> : <Badge tone="warn">All off</Badge>
        }
      />
      <Outcome error={error} done={saved ? 'Saved.' : undefined} />

      <Lede>
        The app&rsquo;s own abuse limiter, not Supabase&rsquo;s auth limiter — that one lives in the
        Supabase dashboard under Authentication &rsaquo; Rate limits. Each bucket allows so many
        calls per window; a call over the line comes back <code>429 RATE_LIMITED</code>. A bucket
        with no row here uses the default compiled into <code>_shared/rateLimit.ts</code>. The
        counting fails open — if the database cannot be reached the call is allowed — so this is
        abuse control, never the paywall.
      </Lede>

      {!enabled ? (
        <Banner tone="danger">
          The master switch is off. Every bucket below is being ignored, whatever it says.
        </Banner>
      ) : null}

      <Card
        title="Master switch"
        eyebrow="All buckets at once"
        bare
        note="Off exempts every bucket at once — the escape hatch for letting a support engineer replay a stuck queue. Nothing is counted while it is off, so turning it back on starts each bucket from a clean window."
      >
        <form action={toggleMaster} className="form card-body">
          <CsrfField />
          <Check name="enabled" label="Rate limiting enabled" defaultChecked={enabled} plain />
          <button type="submit" className="btn">
            {Icon.save}
            <span>Save</span>
          </button>
        </form>
      </Card>

      <h2 className="section">Buckets</h2>
      {rules.length === 0 ? (
        <Card bare>
          <Empty title="No bucket rows" migration="20260809040000_rate_limit_controls">
            The app is still limited by the code defaults until this table has rows.
          </Empty>
        </Card>
      ) : (
        <Card bare>
          <TableScroll>
            <table>
              <caption className="sr-only">Rate limit rules per bucket</caption>
              <thead>
                <tr>
                  <th scope="col">Bucket</th>
                  <th scope="col">Now</th>
                  <th scope="col">Rule</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.bucket}>
                    <th scope="row">
                      <code>{rule.bucket}</code>
                      {KNOWN.includes(rule.bucket) ? null : (
                        <span className="row-sub">no code calls this bucket</span>
                      )}
                    </th>
                    <td>
                      {rule.enabled ? (
                        <Badge tone="ok">
                          {rule.max_calls} / {windowLabel(rule.window_seconds)}
                        </Badge>
                      ) : (
                        <Badge>Off</Badge>
                      )}
                    </td>
                    <td>
                      <form action={saveRule} className="row" style={{ flexWrap: 'nowrap' }}>
                        <CsrfField />
                        <input type="hidden" name="bucket" value={rule.bucket} />
                        <input
                          type="number"
                          name="max_calls"
                          min={0}
                          defaultValue={rule.max_calls}
                          aria-label={`Max calls for ${rule.bucket}`}
                        />
                        <span className="muted small">per</span>
                        <input
                          type="number"
                          name="window_seconds"
                          min={1}
                          defaultValue={rule.window_seconds}
                          aria-label={`Window in seconds for ${rule.bucket}`}
                        />
                        <span className="muted small">s</span>
                        <label className="check plain">
                          <input
                            type="checkbox"
                            name="enabled"
                            defaultChecked={rule.enabled}
                            aria-label={`${rule.bucket} enabled`}
                          />
                          <span aria-hidden>on</span>
                        </label>
                        <button type="submit" className="btn btn-sm">
                          {Icon.save}
                          <span>Save</span>
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <h2 className="section">Add a bucket</h2>
      <Card
        bare
        note={
          <>
            Only a bucket the code actually calls will ever be consulted — adding a name here does
            not create a limiter, it overrides one. The names in use today are{' '}
            {KNOWN.map((bucket, index) => (
              <span key={bucket}>
                {index > 0 ? (index === KNOWN.length - 1 ? ' and ' : ', ') : ''}
                <code>{bucket}</code>
              </span>
            ))}
            .
          </>
        }
      >
        <form action={saveRule} className="form card-body">
          <CsrfField />
          <Field label="Bucket">
            <input type="text" name="bucket" placeholder="expense-write" required />
          </Field>
          <Field label="Max calls">
            <input type="number" name="max_calls" min={0} defaultValue={60} />
          </Field>
          <Field label="Window" hint="seconds">
            <input type="number" name="window_seconds" min={1} defaultValue={60} />
          </Field>
          <Check name="enabled" label="Enabled" defaultChecked />
          <button type="submit" className="btn">
            {Icon.plus}
            <span>Add</span>
          </button>
        </form>
      </Card>
    </main>
  );
}
