import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { CsrfField } from '@/components/CsrfField';
import { Card, Empty, Lede, Outcome, PageHeader, TableScroll } from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import { adEventDays, adGateSettings, saveAdGateSettings, type AdGateSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';
const knobs: { key: keyof AdGateSettings; label: string; min: number; max: number }[] = [
  { key: 'gap_min', label: 'Minimum expense gap', min: 3, max: 20 },
  { key: 'gap_max', label: 'Maximum expense gap', min: 3, max: 20 },
  { key: 'cooldown_seconds', label: 'Interstitial cooldown (seconds)', min: 60, max: 86400 },
  { key: 'interstitial_daily_cap', label: 'Interstitial daily cap (UTC)', min: 0, max: 20 },
  { key: 'grace_days', label: 'New account grace (days)', min: 0, max: 365 },
  { key: 'grace_expenses', label: 'First expenses without interstitials', min: 0, max: 1000 },
  {
    key: 'rewarded_quiet_seconds',
    label: 'Quiet time after rewarded (seconds)',
    min: 60,
    max: 86400,
  },
  { key: 'session_grace_seconds', label: 'Session grace (seconds)', min: 60, max: 3600 },
  { key: 'session_cap', label: 'Interstitial session cap', min: 0, max: 20 },
];
export default async function Ads({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [params, rows, settings] = await Promise.all([
    searchParams,
    adEventDays(),
    adGateSettings(),
  ]);
  async function save(form: FormData) {
    'use server';
    let failure: string | null = null;
    try {
      await guardMutation(form);
      const values = {} as AdGateSettings;
      for (const knob of knobs) {
        const raw = String(form.get(knob.key) ?? '').trim();
        const value = Number(raw);
        if (!raw || !Number.isSafeInteger(value) || value < knob.min || value > knob.max)
          throw new Error(`${knob.label}: enter a whole number from ${knob.min} to ${knob.max}.`);
        values[knob.key] = value;
      }
      await saveAdGateSettings(values);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (failure) redirect(`/ads?error=${encodeURIComponent(failure)}`);
    revalidatePath('/ads');
    redirect('/ads?saved=1');
  }
  return (
    <main className="page">
      <PageHeader eyebrow="Monetization" title="Ads" />
      <Outcome error={params.error} done={params.saved ? 'Saved.' : undefined} />
      <Lede>
        Free accounts only. Daily events by placement for the last 30 days (UTC). Shown counts SDK
        impressions; completion means a rewarded video earned its reward. Expense interstitials are
        dismissible. Enable ads_gates under Experiments to roll out gates.
      </Lede>
      <Card bare>
        <TableScroll>
          <table>
            <caption className="sr-only">Daily ad events by placement</caption>
            <thead>
              <tr>
                {[
                  'Day',
                  'Placement',
                  'Impressions',
                  'Completions',
                  'Skips / dismissals',
                  'Failures',
                  'Grace blocks',
                  'Offline allowed',
                  'Owed offered',
                  'Owed declined',
                  'Blocked (ad blocker)',
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.day}:${row.placement}`}>
                  <th scope="row">{row.day}</th>
                  <td>{row.placement}</td>
                  {[
                    row.shown,
                    row.completed,
                    row.skipped,
                    row.failed,
                    row.blocked_grace,
                    row.offline_allowed,
                    row.owed_offered,
                    row.owed_declined,
                    row.blocked_adblock,
                  ].map((value, i) => (
                    <td key={i} className="n">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        {!rows.length ? (
          <Empty title="No ad events yet">
            Events appear here after the ad gates migration is deployed and ads are served.
          </Empty>
        ) : null}
      </Card>
      <h2 className="section">Pacing settings</h2>
      <Card>
        {settings ? (
          <form action={save}>
            <CsrfField />
            {knobs.map((knob) => (
              <p key={knob.key}>
                <label>
                  {knob.label}{' '}
                  <input
                    type="number"
                    name={knob.key}
                    min={knob.min}
                    max={knob.max}
                    step={1}
                    defaultValue={settings[knob.key]}
                    required
                  />
                </label>
              </p>
            ))}
            <button type="submit" className="btn">
              Save settings
            </button>
          </form>
        ) : (
          <Empty title="Settings unavailable" migration="20261026140000_ad_gates">
            Deploy the migration to configure pacing.
          </Empty>
        )}
      </Card>
    </main>
  );
}
