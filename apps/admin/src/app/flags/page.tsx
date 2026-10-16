import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import {
  Badge,
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
import { flagResults, flags, saveFlag, type FlagResultRow } from '@/lib/data';

export const dynamic = 'force-dynamic';

const num = (value: number | string) => Number(value).toLocaleString('en-IN');

export default async function Flags({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const all = await flags();

  // Results only for the flags actually running. Bucketing every profile is a
  // full scan of `profiles` per flag, and doing it for switches nobody has
  // turned on is work with no reader.
  const running = all.filter((flag) => flag.enabled);
  const results = new Map<string, FlagResultRow[]>(
    await Promise.all(
      running.map(async (flag) => [flag.key, await flagResults(flag.key)] as const),
    ),
  );

  async function save(formData: FormData) {
    'use server';

    const variants = String(formData.get('variants') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

    // Collected rather than rethrown, because `redirect` works by throwing and
    // a catch around it would swallow the navigation.
    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await saveFlag({
        key: String(formData.get('key') ?? '').trim(),
        description: String(formData.get('description') ?? '').trim(),
        enabled: formData.get('enabled') === 'on',
        rolloutPercent: Number(formData.get('rollout') ?? 0),
        variants,
      });
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/flags?error=${encodeURIComponent(failure)}`);
    revalidatePath('/flags');
    redirect('/flags?saved=1');
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="Configuration"
        title="Experiments"
        actions={
          <span className="small muted">
            {running.length} running of {all.length}
          </span>
        }
      />
      <Outcome error={error} done={saved ? 'Saved.' : undefined} />

      <Lede>
        Nobody&rsquo;s assignment is stored. A person&rsquo;s arm is hashed from the flag key and
        their profile id, by the same rule in the app and in the database, so the split needs no
        round trip and an experiment can be read retrospectively — including for the days before it
        occurred to anybody to look.
      </Lede>

      {all.length === 0 ? (
        <Card bare>
          <Empty title="No flags yet" migration="20260808200000_feature_flags">
            Nothing in <code>feature_flags</code> to switch.
          </Empty>
        </Card>
      ) : null}

      <div className="stack">
        {all.map((flag) => {
          const rows = results.get(flag.key) ?? [];
          const enrolled = rows.reduce((sum, row) => sum + Number(row.people), 0);

          return (
            <Card
              key={flag.key}
              title={flag.key}
              // The description is already an editable field two lines down;
              // an eyebrow is a category, not a second copy of the sentence.
              eyebrow="Feature flag"
              actions={
                flag.enabled ? (
                  <Badge tone="ok">On · {flag.rollout_percent}%</Badge>
                ) : (
                  <Badge>Off</Badge>
                )
              }
              bare
            >
              <form action={save} className="form card-body">
                <CsrfField />
                <input type="hidden" name="key" value={flag.key} />
                <Field label="Description">
                  <input
                    type="text"
                    name="description"
                    defaultValue={flag.description}
                    size={34}
                    aria-label={`Description of ${flag.key}`}
                  />
                </Field>
                <Field label="Rollout %">
                  <input
                    type="number"
                    name="rollout"
                    min={0}
                    max={100}
                    defaultValue={flag.rollout_percent}
                    aria-label={`Rollout percentage for ${flag.key}`}
                  />
                </Field>
                <Field label="Arms" hint="comma separated">
                  <input
                    type="text"
                    name="variants"
                    defaultValue={flag.variants.join(', ')}
                    size={22}
                    aria-label={`Arms of ${flag.key}`}
                  />
                </Field>
                <Check name="enabled" label="Enabled" defaultChecked={flag.enabled} />
                <button type="submit" className="btn">
                  {Icon.save}
                  <span>Save</span>
                </button>
              </form>

              {!flag.enabled ? (
                <p className="card-note">
                  Off. Everybody sees whatever the app did before this flag.
                </p>
              ) : rows.length === 0 ? (
                <p className="card-note">
                  Nobody is enrolled. At {flag.rollout_percent}% rollout that is expected if there
                  are few accounts.
                </p>
              ) : (
                <>
                  <p className="card-subhead">Results</p>
                  <TableScroll>
                    <table>
                      <caption className="sr-only">Results per arm of {flag.key}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Arm</th>
                          <th scope="col" className="n">
                            People
                          </th>
                          <th scope="col" className="n">
                            Share
                          </th>
                          <th scope="col" className="n">
                            Expenses created
                          </th>
                          <th scope="col" className="n">
                            Per person
                          </th>
                          <th scope="col" className="n">
                            Active 30d
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.variant}>
                            <th scope="row" style={{ fontWeight: 600 }}>
                              {row.variant}
                            </th>
                            <td className="n">{num(row.people)}</td>
                            <td className="n">
                              {enrolled === 0
                                ? '—'
                                : `${Math.round((Number(row.people) / enrolled) * 100)}%`}
                            </td>
                            <td className="n">{num(row.expenses_created)}</td>
                            <td className="n">
                              {Number(row.people) === 0
                                ? '—'
                                : (Number(row.expenses_created) / Number(row.people)).toFixed(2)}
                            </td>
                            <td className="n">{num(row.active_30d)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                  <p className="card-note">
                    People outside the rollout are not shown. They are not a control group — the
                    experiment never touched them, and putting them beside the arms invites the one
                    comparison that is wrong.
                  </p>
                </>
              )}
            </Card>
          );
        })}
      </div>

      <h2 className="section">New flag</h2>
      <Card bare>
        <form action={save} className="form card-body">
          <CsrfField />
          <Field label="Key">
            <input type="text" name="key" placeholder="itemized_receipts" required />
          </Field>
          <Field label="Description">
            <input type="text" name="description" size={30} />
          </Field>
          <Field label="Rollout %">
            <input type="number" name="rollout" min={0} max={100} defaultValue={0} />
          </Field>
          <Field label="Arms" hint="comma separated">
            <input type="text" name="variants" defaultValue="control, treatment" size={22} />
          </Field>
          <Check name="enabled" label="Enabled" />
          <button type="submit" className="btn">
            {Icon.plus}
            <span>Create</span>
          </button>
        </form>
      </Card>
    </main>
  );
}
