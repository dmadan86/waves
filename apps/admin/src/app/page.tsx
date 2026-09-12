import { format, money, type CurrencyCode } from '@waves/core';

import { Bars } from '@/components/Bars';
import { AreaTrend } from '@/components/charts/AreaTrend';
import { DonutChart } from '@/components/charts/DonutChart';
import { Icon } from '@/components/icons';
import { Card, Empty, PageHeader, Stat, TableScroll } from '@/components/ui';
import { aiCost, daily, geo, logins, money as moneyRows, overview } from '@/lib/data';

export const dynamic = 'force-dynamic';

const num = (value: number | string) => Number(value).toLocaleString('en-IN');

/** Minor units through the ledger's own formatter, so the console cannot disagree with the app. */
function amount(minor: string, currency: string): string {
  try {
    return format(money(BigInt(minor), currency as CurrencyCode));
  } catch {
    // An unknown currency is not worth a 500 on a dashboard.
    return `${minor} ${currency}`;
  }
}

export default async function Dashboard() {
  const [head, days, countries, currencies, ai, signIns] = await Promise.all([
    overview(),
    daily(30),
    geo(),
    moneyRows(),
    aiCost(30),
    logins(30),
  ]);

  if (!head) {
    return (
      <main className="page">
        <PageHeader eyebrow="Overview" title="Dashboard" />
        <Card>
          <Empty title="No analytics to read" migration="20260808190000_admin_analytics">
            The analytics functions returned nothing at all.
          </Empty>
        </Card>
      </main>
    );
  }

  const signInTotal = signIns.rows.reduce((sum, row) => sum + Number(row.sign_ins), 0);

  const trend = days.map((d) => ({
    day: d.day,
    newProfiles: Number(d.new_profiles),
    newExpenses: Number(d.new_expenses),
    active: Number(d.active_profiles),
  }));

  // Share of live expenses by currency — the one split with few enough slices
  // to read as a ring. Never summed across currencies, so this counts expenses,
  // not value.
  const currencySlices = currencies
    .map((row) => ({ name: row.currency, value: Number(row.expense_count) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <main className="page">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        actions={
          <>
            <span className="small muted">
              {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
            </span>
            {/* A plain anchor, not `next/link`: these are route handlers that
                stream a file with a Content-Disposition. A client-side
                navigation to one starts no download. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="btn btn-outline" href="/export/daily">
              {Icon.download}
              <span>Daily CSV</span>
            </a>
          </>
        }
      />

      <section aria-labelledby="figures-head">
        <h2 className="section" id="figures-head">
          Where things stand
        </h2>
        <div className="cols-3">
          <Stat
            label="People"
            value={num(head.profiles_total)}
            sub={`+${num(head.profiles_new_7d)} in the last 7 days`}
            dir={Number(head.profiles_new_7d) > 0 ? 'up' : 'flat'}
            icon={Icon.users}
          />
          <Stat
            label="Groups"
            value={num(head.groups_total)}
            sub={`${num(head.groups_active_30d)} active in 30 days`}
            icon={Icon.layers}
          />
          <Stat
            label="Expenses"
            value={num(head.expenses_total)}
            sub={`+${num(head.expenses_new_30d)} in the last 30 days`}
            dir={Number(head.expenses_new_30d) > 0 ? 'up' : 'flat'}
            icon={Icon.receipt}
          />
          <Stat
            label="Settlements"
            value={num(head.settlements_total)}
            sub={`${num(head.settlements_confirmed)} confirmed`}
            icon={Icon.check}
          />
          <Stat
            label="Active, 30 days"
            value={num(head.active_profiles_30d)}
            sub={`${num(head.active_profiles_7d)} of them in the last 7`}
            icon={Icon.activity}
          />
          <Stat
            label="Deleted expenses"
            value={num(head.expenses_deleted)}
            sub="soft-deleted, still on the ledger"
            icon={Icon.trash}
          />
        </div>
      </section>

      <h2 className="section">Movement</h2>
      <div className="cols-chart">
        <Card
          title="Expenses by currency"
          eyebrow="Split"
          note="Live expenses, counted — never summed across currencies."
          bare
        >
          {currencySlices.length === 0 ? (
            <Empty title="No expenses yet">
              Nothing has been added to a ledger on this project.
            </Empty>
          ) : (
            <DonutChart slices={currencySlices} centerLabel="expenses" />
          )}
        </Card>

        <Card
          note="Active means the ledger recorded something. Opening the app is not written down, so it is not counted here."
          bare
        >
          <AreaTrend days={trend} />
        </Card>
      </div>

      <h2 className="section">Where they are</h2>
      <Card
        bare
        note="This is the device locale the app read at signup, and for groups it is where the group settles. It is not IP geolocation: a phone set to en-GB in Bengaluru counts as GB."
      >
        {countries.length === 0 ? (
          <Empty title="No countries recorded">Nobody has signed up on this project yet.</Empty>
        ) : (
          <TableScroll>
            <table>
              <caption className="sr-only">People, groups and expenses per country</caption>
              <thead>
                <tr>
                  <th scope="col">Country</th>
                  <th scope="col" className="n">
                    People
                  </th>
                  <th scope="col" className="n">
                    Groups
                  </th>
                  <th scope="col" className="n">
                    Expenses
                  </th>
                </tr>
              </thead>
              <tbody>
                {countries.map((row) => (
                  <tr key={row.country_code ?? 'unknown'}>
                    <th scope="row" style={{ fontWeight: 600 }}>
                      {row.country_code ?? <span className="muted">Not set</span>}
                    </th>
                    <td className="n">{num(row.profile_count)}</td>
                    <td className="n">{num(row.group_count)}</td>
                    <td className="n">{num(row.expense_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <h2 className="section">Volume</h2>
      <Card
        bare
        note="Never summed across currencies and never converted — the same rule the product follows. Live expenses at their current version only, so an edited expense counts once."
      >
        {currencies.length === 0 ? (
          <Empty title="No volume yet">No expense has been recorded in any currency.</Empty>
        ) : (
          <TableScroll>
            <table>
              <caption className="sr-only">Expense and settlement volume per currency</caption>
              <thead>
                <tr>
                  <th scope="col">Currency</th>
                  <th scope="col" className="n">
                    Expenses
                  </th>
                  <th scope="col" className="n">
                    Value
                  </th>
                  <th scope="col" className="n">
                    Settled
                  </th>
                  <th scope="col" className="n">
                    Settled value
                  </th>
                </tr>
              </thead>
              <tbody>
                {currencies.map((row) => (
                  <tr key={row.currency}>
                    <th scope="row" style={{ fontWeight: 600 }}>
                      {row.currency}
                    </th>
                    <td className="n">{num(row.expense_count)}</td>
                    <td className="n">{amount(row.expense_minor, row.currency)}</td>
                    <td className="n">{num(row.settlement_count)}</td>
                    <td className="n">{amount(row.settlement_minor, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <h2 className="section">Cost and sign-ins</h2>
      <div className="cols-2">
        <Card title="AI receipt cost" eyebrow="Last 30 days" bare>
          {ai.length === 0 ? (
            <Empty title="No scans in this window">
              Nobody has run a receipt through the pipeline in 30 days.
            </Empty>
          ) : (
            <TableScroll>
              <table>
                <caption className="sr-only">Receipt pipeline cost per day and currency</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Currency</th>
                    <th scope="col" className="n">
                      Scans
                    </th>
                    <th scope="col" className="n">
                      In
                    </th>
                    <th scope="col" className="n">
                      Out
                    </th>
                    <th scope="col" className="n">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ai.map((row) => (
                    <tr key={`${row.day}-${row.currency}`}>
                      <td>{row.day}</td>
                      <td>{row.currency}</td>
                      <td className="n">{num(row.events)}</td>
                      <td className="n">{num(row.input_tokens)}</td>
                      <td className="n">{num(row.output_tokens)}</td>
                      <td className="n">{amount(row.cost_minor, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>

        <Card
          title="Sign-ins"
          eyebrow="Last 30 days"
          bare
          note={
            signIns.unavailable || signIns.rows.length === 0
              ? undefined
              : `${num(signInTotal)} sign-ins in the retained window.`
          }
        >
          {signIns.unavailable ? (
            // Said plainly, and not as an empty chart. This is the only panel
            // reading outside `public`, so it is the only one whose failure
            // means "the grant is missing" rather than "nobody did anything".
            <Empty title="Sign-in history could not be read">
              <code>{signIns.unavailable}</code>. Everything else on this page is unaffected.
            </Empty>
          ) : signIns.rows.length === 0 ? (
            <Empty title="Nothing in the window">
              Supabase prunes its auth audit log, so an empty result here means the retention window
              has passed — not that nobody signed in.
            </Empty>
          ) : (
            <Bars
              label="Sign-ins per day"
              rows={[...signIns.rows]
                .reverse()
                .map((row) => ({ day: row.day, value: Number(row.sign_ins) }))}
            />
          )}
        </Card>
      </div>

      <h2 className="section">Reports</h2>
      <Card>
        {/* Plain anchors on purpose — see the note on the header button. */}
        {/* eslint-disable @next/next/no-html-link-for-pages */}
        <div className="row">
          <a className="btn btn-quiet" href="/export/daily">
            {Icon.download}
            <span>daily.csv</span>
          </a>
          <a className="btn btn-quiet" href="/export/geo">
            {Icon.download}
            <span>geo.csv</span>
          </a>
          <a className="btn btn-quiet" href="/export/money">
            {Icon.download}
            <span>money.csv</span>
          </a>
          <a className="btn btn-quiet" href="/export/ai">
            {Icon.download}
            <span>ai-cost.csv</span>
          </a>
        </div>
        {/* eslint-enable @next/next/no-html-link-for-pages */}
      </Card>
    </main>
  );
}
