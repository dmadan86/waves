import { format, money, type CurrencyCode } from '@waves/core';

import { Badge, Card, Empty, Lede, PageHeader, TableScroll, Tile } from '@/components/ui';
import { agentWrites, appConfig, type AgentWriteRow } from '@/lib/data';

export const dynamic = 'force-dynamic';

const LIMIT = 200;

function amount(minor: string | null, currency: string | null): string {
  if (minor === null || currency === null) return '—';
  try {
    return format(money(BigInt(minor), currency as CurrencyCode));
  } catch {
    return `${minor} ${currency}`;
  }
}

/** `expense.add` → an action verb and a noun, kept in the app's own words. */
function tone(action: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (action.endsWith('.delete')) return 'danger';
  if (action.endsWith('.edit')) return 'warn';
  if (action.endsWith('.add')) return 'ok';
  return 'neutral';
}

/**
 * What automated clients have been doing.
 *
 * The two caps that bound agent writes have been turnable on the Limits page
 * since the day they landed; the writes they bound had no reader anywhere. An
 * audit trail nobody can read is a log file, not an audit — so this is the
 * screen that closes it, and it deliberately shows the caps beside the totals
 * they apply to, because a cap read on a different page from its effect is a
 * number nobody can judge.
 *
 * Read-only, and no `revoke` button. The trust decision lives with the person
 * whose ledger it is (`waves_my_agent_writes` is theirs), not with whoever is
 * looking at this page — this is here so an operator can see a client
 * misbehaving across many accounts at once, which is the one thing no
 * individual person can see for themselves.
 */
export default async function AgentWrites() {
  const [rows, knobs] = await Promise.all([agentWrites(LIMIT), appConfig()]);

  const capFor = (key: string) => knobs.find((knob) => knob.key === key)?.value ?? null;
  const perWrite = capFor('agent_expense_cap_minor');
  const perDay = capFor('agent_daily_cap_minor');

  const clients = summarise(rows);
  const withAmount = rows.filter((row) => row.amount_minor !== null).length;

  return (
    <main className="page">
      <PageHeader eyebrow="Signals" title="Agent writes" />

      <Lede>
        Every write an outside client made on somebody&rsquo;s ledger, newest first — the audit half
        of letting an agent post an expense. No account is named here: an individual&rsquo;s own
        trail is theirs to read in the app, and the question this page exists to answer is the one
        nobody can answer for themselves, which is whether a single client is misbehaving across
        many accounts at once. The last {LIMIT} writes.
      </Lede>

      <div className="autofit">
        <Tile
          label="Writes shown"
          value={rows.length.toLocaleString('en-IN')}
          sub={`newest ${LIMIT}`}
        />
        <Tile label="Clients seen" value={clients.length.toLocaleString('en-IN')} />
        <Tile
          label="Carrying an amount"
          value={withAmount.toLocaleString('en-IN')}
          sub={`${rows.length - withAmount} did not move money`}
        />
        <Tile
          label="Cap per write"
          value={perWrite === null ? '—' : perWrite.toLocaleString('en-IN')}
          sub="agent_expense_cap_minor, minor units"
        />
        <Tile
          label="Cap per day"
          value={perDay === null ? '—' : perDay.toLocaleString('en-IN')}
          sub="agent_daily_cap_minor, minor units"
        />
      </div>

      <h2 className="section">By client</h2>
      <Card
        bare
        note="Counted over the writes on this page only, so a client that was busy last month and quiet since will not appear. This is a recent-behaviour view, not a lifetime total."
      >
        {clients.length === 0 ? (
          <Empty
            title="No agent has written anything"
            migration="20260907140000_agent_writes_and_caps"
          >
            Either no client has been authorised yet, or none has posted.
          </Empty>
        ) : (
          <TableScroll>
            <table>
              <caption className="sr-only">Recent writes grouped by client</caption>
              <thead>
                <tr>
                  <th scope="col">Client</th>
                  <th scope="col" className="n">
                    Writes
                  </th>
                  <th scope="col">Actions</th>
                  <th scope="col">Most recent</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id}>
                    <th scope="row">
                      <code>{client.id}</code>
                    </th>
                    <td className="n">{client.writes.toLocaleString('en-IN')}</td>
                    <td>
                      <span className="row" style={{ gap: '0.25rem' }}>
                        {client.actions.map((action) => (
                          <Badge key={action} tone={tone(action)}>
                            {action}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="muted">
                      {new Date(client.latest).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <h2 className="section">Every write</h2>
      <Card bare>
        {rows.length === 0 ? (
          <Empty title="Nothing recorded" migration="20260907140000_agent_writes_and_caps" />
        ) : (
          <TableScroll>
            <table>
              <caption className="sr-only">Agent writes, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Client</th>
                  <th scope="col">Action</th>
                  <th scope="col" className="n">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="muted">
                      {new Date(row.created_at).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td>
                      <code>{row.client_id}</code>
                    </td>
                    <td>
                      <Badge tone={tone(row.action)}>{row.action}</Badge>
                    </td>
                    <td className="n">{amount(row.amount_minor, row.currency)}</td>
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

interface ClientSummary {
  id: string;
  writes: number;
  actions: string[];
  latest: string;
}

/**
 * Fold the rows into one line per client.
 *
 * Done here rather than in SQL on purpose: this is a hundred-row page, the
 * aggregate is a `Map`, and the alternative is a migration adding a
 * `waves_admin_*` function to save a loop. Should this page ever want a
 * lifetime total instead of "the last two hundred writes", that *is* the point
 * at which it needs a function, because the answer stops fitting in a page.
 */
function summarise(rows: readonly AgentWriteRow[]): ClientSummary[] {
  const byClient = new Map<string, { writes: number; actions: Set<string>; latest: string }>();

  for (const row of rows) {
    const entry = byClient.get(row.client_id) ?? {
      writes: 0,
      actions: new Set<string>(),
      latest: row.created_at,
    };
    entry.writes += 1;
    entry.actions.add(row.action);
    // Rows arrive newest first, so the first one seen for a client is its most
    // recent — but never assume the order of somebody else's result set.
    if (row.created_at > entry.latest) entry.latest = row.created_at;
    byClient.set(row.client_id, entry);
  }

  return [...byClient.entries()]
    .map(([id, entry]) => ({
      id,
      writes: entry.writes,
      actions: [...entry.actions].sort(),
      latest: entry.latest,
    }))
    .sort((a, b) => b.writes - a.writes);
}
