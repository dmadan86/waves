import { Badge, Card, Empty, Lede, PageHeader, Tile } from '@/components/ui';
import { voiceAttempts } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * What the mic heard and the parser could not turn into an expense.
 *
 * The device reports only misses (item_count 0), silently and with the
 * person's analytics consent, so this is the raw material for improving voice
 * quick-add: the actual sentences that failed, newest first.
 */
export default async function VoiceAttemptsPage() {
  const rows = await voiceAttempts(200);
  const withModel = rows.filter((row) => row.used_model).length;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Signals"
        title="Voice attempts"
        actions={<span className="small muted">newest {rows.length}</span>}
      />

      <Lede>
        These are raw speech transcripts, so they can name people, amounts and places. They are read
        here and nowhere else. The profile id is kept, unlike feedback, so a confusing miss can be
        traced back to the person who spoke it and the parser tuned against real usage.
      </Lede>

      <div className="cols-3">
        <Tile label="Unparsed" value={rows.length} sub="dictations the parser could not use" />
        <Tile label="Model tier" value={withModel} />
        <Tile label="On-device" value={rows.length - withModel} />
      </div>

      <h2 className="section">Newest first</h2>
      <Card bare>
        {rows.length === 0 ? (
          <Empty title="Nothing yet" migration="20260828000000_voice_attempts">
            Attempts arrive only when a dictation fails to parse and the person has turned analytics
            on.
          </Empty>
        ) : (
          <ul className="feed">
            {rows.map((row) => (
              <li key={row.id}>
                <div className="meta">
                  <Badge tone={row.used_model ? 'accent' : 'neutral'}>
                    {row.used_model ? 'model' : 'on-device'}
                  </Badge>
                  <time dateTime={row.created_at}>
                    {new Date(row.created_at).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </time>
                  {row.locale ? <span>{row.locale}</span> : null}
                  {row.platform ? <span>{row.platform}</span> : null}
                  {row.app_version ? <span>v{row.app_version}</span> : null}
                  {row.profile_id ? <code>{row.profile_id}</code> : null}
                </div>
                <p>{row.transcript}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
