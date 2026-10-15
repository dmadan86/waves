import { Badge, Card, Empty, Lede, PageHeader, TableScroll, type Tone } from '@/components/ui';
import { kpis, retentionCohorts, type KpiRow } from '@/lib/data';
import {
  KPI_THRESHOLDS,
  kpiStatus,
  percent,
  ratio,
  type KpiKey,
  type KpiStatus,
} from '@/lib/kpiStatus';

export const dynamic = 'force-dynamic';

/** Where crash-free sessions live. A placeholder: Sentry is not read from here. */
const SENTRY_URL = 'https://sentry.io/';

const num = (value: number | string) => Number(value).toLocaleString('en-IN');
const asRatio = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

const TONE: Record<KpiStatus, Tone> = { ok: 'ok', warn: 'warn', bad: 'danger', unknown: 'neutral' };
const LABEL: Record<KpiStatus, string> = {
  ok: 'On target',
  warn: 'Watch',
  bad: 'Below',
  unknown: 'Not enough data',
};

interface Line {
  key: KpiKey;
  label: string;
  value: number | null;
  /** What was divided by what, so the maturity of the cohort is visible. */
  basis: string;
}

function lines(row: KpiRow): Line[] {
  return [
    {
      key: 'install_to_registration',
      label: 'Install → registration',
      value: asRatio(row.install_to_registration),
      basis: `${num(row.registrations)} registered / ${num(row.installs)} installs`,
    },
    {
      key: 'registration_to_activation',
      label: 'Registration → activation',
      value: asRatio(row.registration_to_activation),
      basis: `${num(row.activated)} activated / ${num(row.activation_cohort)} registered 7+ days ago`,
    },
    {
      key: 'd1',
      label: 'D1 retention',
      value: asRatio(row.d1),
      basis: `${num(row.d1_retained)} / ${num(row.d1_cohort)} old enough`,
    },
    {
      key: 'd7',
      label: 'D7 retention',
      value: asRatio(row.d7),
      basis: `${num(row.d7_retained)} / ${num(row.d7_cohort)} old enough`,
    },
    {
      key: 'd30',
      label: 'D30 retention',
      value: asRatio(row.d30),
      basis: `${num(row.d30_retained)} / ${num(row.d30_cohort)} old enough`,
    },
    {
      key: 'invite_to_registration',
      label: 'Invite → registration',
      value: asRatio(row.invite_to_registration),
      basis: `${num(row.invite_registrations)} brought someone new / ${num(row.invites_sent)} sent`,
    },
  ];
}

const targetText = (key: KpiKey): string => {
  const t = KPI_THRESHOLDS[key];
  if (key === 'cost_per_activated_user') return `≤ ₹${t.target} (warn > ₹${t.warn})`;
  const digits = key === 'crash_free_sessions' ? 1 : 0;
  return `≥ ${(t.target * 100).toFixed(digits)}% (warn < ${(t.warn * 100).toFixed(digits)}%)`;
};

export default async function Kpis() {
  const [row, cohorts] = await Promise.all([kpis(30), retentionCohorts(8)]);

  if (!row) {
    return (
      <main className="page">
        <PageHeader eyebrow="Growth" title="Activation & retention" />
        <Card>
          <Empty title="No KPIs to read" migration="20261015120000_app_events">
            The KPI functions returned nothing at all.
          </Empty>
        </Card>
      </main>
    );
  }

  return (
    <main className="page">
      <PageHeader eyebrow="Growth" title="Activation & retention" />
      <Lede>
        People who signed up in the last 30 days. Activated means a registered account created an
        expense, a settlement or a personal record within 7 days of signing up. Retention counts a
        day only once it has fully passed, so a young cohort is left out rather than counted as
        lost. Guest accounts are not registrations.
      </Lede>

      <h2 className="section">Targets</h2>
      <Card
        bare
        note="Installs are counted from the app's own app_installed event, so they start from the release that ships it."
      >
        <TableScroll>
          <table>
            <caption className="sr-only">Activation and retention against target</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col" className="n">
                  Now
                </th>
                <th scope="col">Target</th>
                <th scope="col">Status</th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              {lines(row).map((line) => {
                const status = kpiStatus(line.value, KPI_THRESHOLDS[line.key]);
                return (
                  <tr key={line.key}>
                    <th scope="row" style={{ fontWeight: 600 }}>
                      {line.label}
                    </th>
                    <td className="n">{percent(line.value)}</td>
                    <td>{targetText(line.key)}</td>
                    <td>
                      <Badge tone={TONE[status]}>{LABEL[status]}</Badge>
                    </td>
                    <td className="small muted">{line.basis}</td>
                  </tr>
                );
              })}
              <tr>
                <th scope="row" style={{ fontWeight: 600 }}>
                  Crash-free sessions
                </th>
                <td className="n">–</td>
                <td>{targetText('crash_free_sessions')}</td>
                <td>
                  <Badge>Not measured here</Badge>
                </td>
                <td className="small muted">
                  From Sentry —{' '}
                  <a href={SENTRY_URL} target="_blank" rel="noreferrer noopener">
                    open Sentry (link to be set)
                  </a>
                </td>
              </tr>
              <tr>
                <th scope="row" style={{ fontWeight: 600 }}>
                  Paid cost per activated user
                </th>
                <td className="n">–</td>
                <td>{targetText('cost_per_activated_user')}</td>
                <td>
                  <Badge>Needs input</Badge>
                </td>
                <td className="small muted">Needs ad spend input; not computed.</td>
              </tr>
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <h2 className="section">Weekly signup cohorts</h2>
      <Card
        bare
        note="Each figure is retained / old enough to measure. A young cohort shows a dash instead of a zero."
      >
        {cohorts.length === 0 ? (
          <Empty title="No cohorts">Nobody has signed up in this window.</Empty>
        ) : (
          <TableScroll>
            <table>
              <caption className="sr-only">Signups per week with activation and retention</caption>
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  <th scope="col" className="n">
                    Signed up
                  </th>
                  <th scope="col" className="n">
                    Activated
                  </th>
                  <th scope="col" className="n">
                    D1
                  </th>
                  <th scope="col" className="n">
                    D7
                  </th>
                  <th scope="col" className="n">
                    D30
                  </th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.week_start}>
                    <th scope="row" style={{ fontWeight: 600 }}>
                      {c.week_start}
                    </th>
                    <td className="n">{num(c.size)}</td>
                    <Cell got={c.activated} of={c.activation_eligible} />
                    <Cell got={c.d1_retained} of={c.d1_eligible} />
                    <Cell got={c.d7_retained} of={c.d7_eligible} />
                    <Cell got={c.d30_retained} of={c.d30_eligible} />
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </main>
  );
}

/** `3 / 10 · 30.0%`, or a dash while nobody in the cohort is old enough. */
function Cell({ got, of }: { got: number | string; of: number | string }) {
  const share = ratio(Number(got), Number(of));
  if (share === null) {
    return (
      <td className="n muted" title="No one in this cohort is old enough yet">
        –
      </td>
    );
  }
  return (
    <td className="n">
      {num(got)} / {num(of)} · {percent(share)}
    </td>
  );
}
