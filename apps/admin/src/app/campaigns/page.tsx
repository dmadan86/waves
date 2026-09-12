import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { format, money, type CurrencyCode } from '@waves/core';

import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import { Badge, Card, Empty, Field, Lede, Outcome, PageHeader, TableScroll } from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import {
  broadcastCampaign,
  campaignEmailStats,
  campaignFunnel,
  campaignRevenue,
  campaigns,
  createCampaign,
  promoCodes,
  type CampaignEmailStatRow,
  type CampaignRevenueRow,
  type FunnelRow,
} from '@/lib/data';

export const dynamic = 'force-dynamic';

const num = (value: number | string) => Number(value).toLocaleString('en-IN');
const pct = (part: number, whole: number) =>
  whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;

function amount(minor: string, currency: string): string {
  try {
    return format(money(BigInt(minor), currency as CurrencyCode));
  } catch {
    return `${minor} ${currency}`;
  }
}

/**
 * The number the whole feature exists for.
 *
 * Revenue per person in the targeted arm minus revenue per person in the
 * holdout, times the targeted population. Per person because the arms are
 * different sizes; against the holdout because the value of what was given away
 * is not an impact, it is a cost.
 */
function incremental(rows: CampaignRevenueRow[], funnel: FunnelRow[], currency: string) {
  const heads = new Map(funnel.map((row) => [row.cohort, BigInt(row.people)]));
  const revenueFor = (cohort: string) =>
    BigInt(
      rows.find((row) => row.cohort === cohort && row.currency === currency)?.revenue_minor ?? 0,
    );

  const targetedPeople = heads.get('targeted') ?? 0n;
  const holdoutPeople = heads.get('holdout') ?? 0n;
  if (targetedPeople === 0n || holdoutPeople === 0n) return null;

  // Per-person revenue times the targeted population, done in exact minor units.
  // The per-targeted term collapses to the targeted revenue itself; only the
  // holdout share carries a division, rounded to the nearest minor unit
  // (round half up — both operands are non-negative here).
  const revTargeted = revenueFor('targeted');
  const revHoldout = revenueFor('holdout');
  const holdoutShare = (revHoldout * targetedPeople + holdoutPeople / 2n) / holdoutPeople;
  return revTargeted - holdoutShare;
}

export default async function Campaigns({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { error, done } = await searchParams;
  const [all, codes] = await Promise.all([campaigns(), promoCodes()]);

  const results = new Map(
    await Promise.all(
      all.map(
        async (campaign) =>
          [
            campaign.id,
            {
              funnel: await campaignFunnel(campaign.id),
              revenue: await campaignRevenue(campaign.id),
              email: await campaignEmailStats(campaign.id),
            },
          ] as const,
      ),
    ),
  );

  async function create(formData: FormData) {
    'use server';

    const countries = String(formData.get('countries') ?? '')
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await createCampaign({
        name: String(formData.get('name') ?? ''),
        title: String(formData.get('title') ?? ''),
        body: String(formData.get('body') ?? ''),
        ctaLabel: String(formData.get('cta') ?? ''),
        promoCode: String(formData.get('code') ?? '') || null,
        endsAt: String(formData.get('ends') ?? ''),
        countries: countries.length > 0 ? countries : null,
        holdoutPercent: Number(formData.get('holdout') ?? 10),
      });
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/campaigns?error=${encodeURIComponent(failure)}`);
    revalidatePath('/campaigns');
    redirect('/campaigns?done=Campaign+created');
  }

  async function broadcast(formData: FormData) {
    'use server';

    const id = String(formData.get('id') ?? '');
    let message: string;
    try {
      await guardMutation(formData);
      const result = await broadcastCampaign(id);
      // The holdout is never in this count — it is the control group, and mailing
      // it is the one thing the whole design forbids.
      message = `Sent ${result.sent}, ${result.failed} failed${
        result.more ? ' · more to send, press again' : ''
      }`;
    } catch (caught) {
      const failure = caught instanceof Error ? caught.message : String(caught);
      redirect(`/campaigns?error=${encodeURIComponent(failure)}`);
    }

    revalidatePath('/campaigns');
    redirect(`/campaigns?done=${encodeURIComponent(message)}`);
  }

  const running = all.filter(
    (c) => new Date(c.starts_at) <= new Date() && new Date(c.ends_at) > new Date(),
  ).length;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Growth"
        title="Campaigns"
        actions={
          <span className="small muted">
            {running} live of {all.length}
          </span>
        }
      />
      <Outcome error={error} done={done} />

      <Lede>
        Every campaign withholds itself from a slice of its own audience. That holdout is the only
        reason &ldquo;did this work&rdquo; has an answer: a comped subscription earns nothing by
        construction, so the impact is whether the people who were offered it went on to pay more
        than the people who were not.
      </Lede>

      {all.length === 0 ? (
        <Card bare>
          <Empty title="No campaigns yet" migration="20260808220000_campaigns">
            Nothing has been sent to anybody.
          </Empty>
        </Card>
      ) : null}

      <div className="stack">
        {all.map((campaign) => {
          const result = results.get(campaign.id);
          const funnel = result?.funnel ?? [];
          const revenue = result?.revenue ?? [];
          const emailStats: CampaignEmailStatRow[] = result?.email ?? [];
          const emailCount = (status: string) =>
            Number(emailStats.find((row) => row.status === status)?.count ?? 0);
          const targeted = funnel.find((row) => row.cohort === 'targeted');
          const currencies = [...new Set(revenue.map((row) => row.currency))];
          const live =
            new Date(campaign.starts_at) <= new Date() && new Date(campaign.ends_at) > new Date();

          return (
            <Card
              key={campaign.id}
              title={campaign.name}
              eyebrow="Campaign"
              actions={live ? <Badge tone="ok">Live</Badge> : <Badge>Ended</Badge>}
              bare
            >
              <p className="card-note">
                <strong>{campaign.title}</strong>
                {' · '}
                {campaign.body ? <>{campaign.body} · </> : null}
                {campaign.promo_code ? (
                  <>
                    code <code>{campaign.promo_code}</code> ·{' '}
                  </>
                ) : null}
                {campaign.holdout_percent}% holdout ·{' '}
                {campaign.audience_countries?.join(', ') || 'everywhere'} · ends{' '}
                {new Date(campaign.ends_at).toLocaleDateString('en-IN')}
              </p>

              <p className="card-subhead">Funnel</p>
              <TableScroll>
                <table>
                  <caption className="sr-only">{campaign.name}: funnel per cohort</caption>
                  <thead>
                    <tr>
                      <th scope="col">Cohort</th>
                      <th scope="col" className="n">
                        People
                      </th>
                      <th scope="col" className="n">
                        Saw it
                      </th>
                      <th scope="col" className="n">
                        Redeemed
                      </th>
                      <th scope="col" className="n">
                        Paid
                      </th>
                      <th scope="col" className="n">
                        Pay rate
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.map((row) => (
                      <tr key={row.cohort}>
                        <th scope="row" style={{ fontWeight: 600 }}>
                          {row.cohort}
                        </th>
                        <td className="n">{num(row.people)}</td>
                        <td className="n">{num(row.seen)}</td>
                        <td className="n">{num(row.redeemed)}</td>
                        <td className="n">{num(row.paid)}</td>
                        <td className="n">{pct(Number(row.paid), Number(row.people))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>

              {currencies.length === 0 ? (
                <p className="card-note">No purchases in either arm yet.</p>
              ) : (
                <>
                  <p className="card-subhead">Revenue</p>
                  <TableScroll>
                    <table>
                      <caption className="sr-only">
                        {campaign.name}: incremental revenue per currency
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Currency</th>
                          <th scope="col" className="n">
                            Targeted
                          </th>
                          <th scope="col" className="n">
                            Holdout
                          </th>
                          <th scope="col" className="n">
                            Incremental
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {currencies.map((currency) => {
                          const lift = incremental(revenue, funnel, currency);
                          const forCohort = (cohort: string) =>
                            revenue.find(
                              (row) => row.cohort === cohort && row.currency === currency,
                            )?.revenue_minor ?? '0';
                          return (
                            <tr key={currency}>
                              <th scope="row" style={{ fontWeight: 600 }}>
                                {currency}
                              </th>
                              <td className="n">{amount(forCohort('targeted'), currency)}</td>
                              <td className="n">{amount(forCohort('holdout'), currency)}</td>
                              {/* Colour is the *second* signal: the sign is
                                  already in the number, so a red minus still
                                  reads as a minus without the red. */}
                              <td
                                className={
                                  lift === null ? 'n muted' : lift >= 0n ? 'n pos' : 'n neg'
                                }
                              >
                                {lift === null ? '—' : amount(String(lift), currency)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableScroll>
                  <p className="card-note">
                    Incremental is revenue per person in the targeted arm minus revenue per person
                    in the holdout, times the targeted population. Per person because the arms are
                    different sizes. It goes negative when the giveaway cannibalised purchases
                    people would have made anyway, and that is a real result rather than a bug.
                    {targeted && Number(targeted.people) < 200 ? (
                      <>
                        {' '}
                        With {num(targeted.people)} people in the targeted arm this is noisy — treat
                        it as a direction, not a figure.
                      </>
                    ) : null}
                  </p>
                </>
              )}

              <p className="card-subhead">Email</p>
              <div className="card-body">
                <p className="small muted" style={{ margin: '0 0 0.75rem' }}>
                  Sent {num(emailCount('sent'))}
                  {emailCount('failed') > 0 ? `, ${num(emailCount('failed'))} failed` : ''}
                  {emailCount('queued') > 0 ? `, ${num(emailCount('queued'))} in flight` : ''}. The
                  holdout is never mailed, so this reaches the targeted cohort only.
                </p>
                {live ? (
                  <form action={broadcast}>
                    <CsrfField />
                    <input type="hidden" name="id" value={campaign.id} />
                    <button type="submit" className="btn">
                      {Icon.send}
                      <span>Send to targeted cohort</span>
                    </button>
                  </form>
                ) : (
                  <p className="small muted" style={{ margin: 0 }}>
                    Email only sends while a campaign is live. This one is not running now.
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="section">New campaign</h2>
      <Card bare>
        <form action={create} className="form card-body">
          <CsrfField />
          <Field label="Name" hint="internal">
            <input type="text" name="name" placeholder="Diwali 2026" />
          </Field>
          <Field label="Title">
            <input type="text" name="title" placeholder="Two months of Plus, free" required />
          </Field>
          <Field label="Body" full>
            <input type="text" name="body" placeholder="Because you have been here a while" />
          </Field>
          <Field label="Button">
            <input type="text" name="cta" placeholder="Claim it" defaultValue="Claim it" />
          </Field>
          <Field label="Promo code">
            <select name="code" defaultValue="">
              <option value="">None</option>
              {codes.map((code) => (
                <option key={code.code} value={code.code}>
                  {code.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ends">
            <input type="date" name="ends" required />
          </Field>
          <Field label="Countries" hint="blank for all">
            <input type="text" name="countries" placeholder="IN, AE" />
          </Field>
          <Field label="Holdout %">
            <input type="number" name="holdout" min={1} max={90} defaultValue={10} />
          </Field>
          <button type="submit" className="btn">
            {Icon.plus}
            <span>Create campaign</span>
          </button>
        </form>
      </Card>
    </main>
  );
}
