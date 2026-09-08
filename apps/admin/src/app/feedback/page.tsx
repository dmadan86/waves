import { Badge, Card, Empty, Lede, PageHeader, Tile, type Tone } from '@/components/ui';
import { feedback } from '@/lib/data';

export const dynamic = 'force-dynamic';

const KINDS = ['general', 'bug', 'idea', 'deletion'] as const;

const KIND_LABEL: Record<string, string> = {
  general: 'General',
  bug: 'Broken',
  idea: 'Idea',
  deletion: 'Left',
};

const KIND_TONE: Record<string, Tone> = {
  general: 'neutral',
  bug: 'danger',
  idea: 'ok',
  deletion: 'accent',
};

export default async function FeedbackPage() {
  const rows = await feedback(200);
  const counts = rows.reduce<Record<string, number>>((tally, row) => {
    tally[row.kind] = (tally[row.kind] ?? 0) + 1;
    return tally;
  }, {});

  return (
    <main className="page">
      <PageHeader
        eyebrow="Signals"
        title="Feedback"
        actions={<span className="small muted">newest {rows.length}</span>}
      />

      <Lede>
        There is no author column here and no way to ask for one. Knowing who complained is not
        needed in order to act on a complaint. Where it says <em>account deleted</em>, the person
        has since erased themselves — their words are kept on purpose, because why somebody leaves
        is the most useful thing they ever write, and cascading it away at that moment would destroy
        exactly that.
      </Lede>

      <div className="cols-4">
        {KINDS.map((kind) => (
          <Tile key={kind} label={KIND_LABEL[kind]!} value={counts[kind] ?? 0} />
        ))}
      </div>

      <h2 className="section">Newest first</h2>
      <Card bare>
        {rows.length === 0 ? (
          <Empty title="Nothing yet" migration="20260808230000_feedback_and_erasure">
            Nobody has written in.
          </Empty>
        ) : (
          <ul className="feed">
            {rows.map((row) => (
              <li key={row.id}>
                <div className="meta">
                  <Badge tone={KIND_TONE[row.kind] ?? 'neutral'}>
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </Badge>
                  {row.rating ? (
                    <span aria-label={`${row.rating} out of 5`}>
                      <span aria-hidden>{'★'.repeat(row.rating)}</span>
                    </span>
                  ) : null}
                  <time dateTime={row.created_at}>
                    {new Date(row.created_at).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </time>
                  {row.platform ? <span>{row.platform}</span> : null}
                  {row.app_version ? <span>v{row.app_version}</span> : null}
                  {row.country_code ? <span>{row.country_code}</span> : null}
                  {row.locale ? <span>{row.locale}</span> : null}
                  {row.from_deleted_account ? <span className="gone">account deleted</span> : null}
                </div>
                <p>{row.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
