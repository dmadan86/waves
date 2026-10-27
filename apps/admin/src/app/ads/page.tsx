import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { CsrfField } from '@/components/CsrfField';
import { Card, Empty, Lede, Outcome, PageHeader, TableScroll } from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import {
  adCreditStats,
  adEventDays,
  adGateSettings,
  saveAdGateSettings,
  type AdGateSettings,
} from '@/lib/data';

import { bannerStats, creditDays, creditKnobs, rewardedCompletions } from '@/lib/ads';

export const dynamic = 'force-dynamic';
const knobs: {
  key: Exclude<keyof AdGateSettings, 'interstitial_video_enabled'>;
  label: string;
  min: number;
  max: number;
}[] = [
  {
    key: 'banner_min_account_age_days',
    label: 'Banner minimum account age (days)',
    min: 0,
    max: 365,
  },
  { key: 'native_daily_cap', label: 'Native ads per day', min: 0, max: 100 },
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
  const [params, rows, settings, credits] = await Promise.all([
    searchParams,
    adEventDays(),
    adGateSettings(),
    adCreditStats(30),
  ]);
  async function save(form: FormData) {
    'use server';
    let failure: string | null = null;
    try {
      await guardMutation(form);
      const values = {} as AdGateSettings;
      for (const knob of [...knobs, ...creditKnobs]) {
        const raw = String(form.get(knob.key) ?? '').trim();
        if (knob.key === 'native_daily_cap' && !raw) {
          values.native_daily_cap = null;
          continue;
        }
        const value = Number(raw);
        if (!raw || !Number.isSafeInteger(value) || value < knob.min || value > knob.max)
          throw new Error(`${knob.label}: enter a whole number from ${knob.min} to ${knob.max}.`);
        Object.assign(values, { [knob.key]: value });
      }
      values.interstitial_video_enabled = form.get('interstitial_video_enabled') === 'on';
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
                  'Credits used',
                  'Credits earned',
                  'Offline capped',
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
                    row.credit_used,
                    row.credit_earned,
                    row.offline_capped,
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
      <h2 className="section">Banner ads</h2>
      <Card bare>
        <TableScroll>
          <table>
            <thead>
              <tr>
                {[
                  'Placement',
                  'Shown today',
                  'Failed today',
                  'Shown last 7 days',
                  'Failed last 7 days',
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bannerStats(rows, new Date().toISOString().slice(0, 10)).map((row) => (
                <tr key={row.placement}>
                  <th scope="row">{row.placement}</th>
                  {[row.shownToday, row.failedToday, row.shownLast7Days, row.failedLast7Days].map(
                    (value, i) => (
                      <td key={i} className="n">
                        {value}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
      <h2 className="section">Rewarded completions by placement</h2>
      <Card bare>
        <TableScroll>
          <table>
            <thead>
              <tr>
                <th scope="col">Placement</th>
                <th scope="col">Completions</th>
              </tr>
            </thead>
            <tbody>
              {rewardedCompletions(rows).map((row) => (
                <tr key={row.placement}>
                  <th scope="row">{row.placement}</th>
                  <td className="n">{row.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
      <h2 className="section">Credits per day</h2>
      <Card bare>
        {credits === null ? (
          <Empty title="Not available yet">
            Credit reporting will appear after the credits migration is deployed.
          </Empty>
        ) : credits.length ? (
          <TableScroll>
            <table>
              <thead>
                <tr>
                  <th scope="col">Day (UTC)</th>
                  <th scope="col">Earned</th>
                  <th scope="col">Spent</th>
                  <th scope="col">Events per reason</th>
                </tr>
              </thead>
              <tbody>
                {creditDays(credits).map((row) => (
                  <tr key={row.day}>
                    <th scope="row">{row.day}</th>
                    <td className="n">{row.earned}</td>
                    <td className="n">{row.spent}</td>
                    <td>
                      {Object.entries(row.reasons)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([reason, events]) => `${reason}: ${events}`)
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <Empty title="No credit activity yet">
            Earned and spent credits over the last 30 days (UTC).
          </Empty>
        )}
      </Card>
      <h2 className="section">Pacing and credit settings</h2>
      <Card>
        {settings ? (
          <form action={save}>
            <CsrfField />
            {[...knobs, ...creditKnobs].map((knob) => (
              <p key={knob.key}>
                <label>
                  {knob.label}{' '}
                  <input
                    type="number"
                    name={knob.key}
                    min={knob.min}
                    max={knob.max}
                    step={1}
                    defaultValue={
                      settings[knob.key] ?? ('defaultValue' in knob ? knob.defaultValue : undefined)
                    }
                    placeholder={knob.key === 'native_daily_cap' ? 'Unlimited' : undefined}
                    required={knob.key !== 'native_daily_cap'}
                  />
                </label>
              </p>
            ))}
            <p>
              <label>
                <input
                  type="checkbox"
                  name="interstitial_video_enabled"
                  defaultChecked={settings.interstitial_video_enabled ?? false}
                />{' '}
                Enable interstitial video
              </label>
            </p>
            <p>
              Voice per ad: {settings.voice_per_ad ?? '—'} (legacy, unused) · Scans per ad:{' '}
              {settings.scans_per_ad ?? '—'} (legacy, unused)
            </p>
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
