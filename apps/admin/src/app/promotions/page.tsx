import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import { Card, Empty, Field, Lede, Outcome, PageHeader, TableScroll } from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import { createPromoCode, grantPromo, promoCodes } from '@/lib/data';

export const dynamic = 'force-dynamic';

const num = (value: number | string) => Number(value).toLocaleString('en-IN');
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString('en-IN') : '—');

export default async function Promotions({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { error, done } = await searchParams;
  const codes = await promoCodes();

  async function create(formData: FormData) {
    'use server';

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await createPromoCode({
        code: String(formData.get('code') ?? ''),
        days: Number(formData.get('days') ?? 30),
        maxRedemptions: Number(formData.get('max') ?? 1),
        note: String(formData.get('note') ?? '').trim(),
      });
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/promotions?error=${encodeURIComponent(failure)}`);
    revalidatePath('/promotions');
    redirect('/promotions?done=Code+created');
  }

  async function grant(formData: FormData) {
    'use server';

    let failure: string | null = null;
    let message = '';
    try {
      await guardMutation(formData);
      message = await grantPromo(
        String(formData.get('profile') ?? ''),
        Number(formData.get('days') ?? 30),
      );
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/promotions?error=${encodeURIComponent(failure)}`);
    revalidatePath('/promotions');
    redirect(`/promotions?done=${encodeURIComponent(message)}`);
  }

  return (
    <main className="page">
      <PageHeader eyebrow="Growth" title="Promotions" />
      <Outcome error={error} done={done} />

      <Lede>
        A promotion is an ordinary <code>subscriptions</code> row with{' '}
        <code>store = &lsquo;promo&rsquo;</code>. Every screen that already asks what plan somebody
        is on gets the right answer with no change — there is no second source of truth for who has
        paid.
      </Lede>

      <div className="cols-2">
        <Card
          title="Comp an account"
          eyebrow="One person"
          bare
          note="Keyed on the account and the day, so pressing this twice in one conversation is the same grant rather than two months."
        >
          <form action={grant} className="form card-body">
            <CsrfField />
            <Field label="Profile id" hint="uuid" full>
              <input type="text" name="profile" placeholder="uuid" required />
            </Field>
            <Field label="Days">
              <input type="number" name="days" min={1} max={3650} defaultValue={30} />
            </Field>
            <button type="submit" className="btn">
              {Icon.plus}
              <span>Grant Plus</span>
            </button>
          </form>
        </Card>

        <Card
          title="New code"
          eyebrow="Many people"
          bare
          note="Uppercase letters and digits only — these get read aloud and typed by hand. Redeeming is one code per account, enforced by the same unique key the app stores use to stop a replayed store webhook granting a purchase twice."
        >
          <form action={create} className="form card-body">
            <CsrfField />
            <Field label="Code">
              <input type="text" name="code" placeholder="DIWALI25" required size={14} />
            </Field>
            <Field label="Days granted">
              <input type="number" name="days" min={1} max={3650} defaultValue={30} />
            </Field>
            <Field label="Max redemptions">
              <input type="number" name="max" min={1} defaultValue={100} />
            </Field>
            <Field label="Note" full>
              <input type="text" name="note" placeholder="Diwali campaign" />
            </Field>
            <button type="submit" className="btn">
              {Icon.plus}
              <span>Create code</span>
            </button>
          </form>
        </Card>
      </div>

      <h2 className="section">Codes</h2>
      <Card bare>
        {codes.length === 0 ? (
          <Empty title="No codes yet" migration="20260808210000_promotions">
            Nothing in <code>promo_codes</code>.
          </Empty>
        ) : (
          <TableScroll>
            <table>
              <caption className="sr-only">Promotional codes and their redemptions</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col" className="n">
                    Grants
                  </th>
                  <th scope="col" className="n">
                    Used
                  </th>
                  <th scope="col" className="n">
                    Of
                  </th>
                  <th scope="col">Expires</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((row) => (
                  <tr key={row.code}>
                    <th scope="row">
                      <code>{row.code}</code>
                    </th>
                    <td className="n">{num(row.days)} days</td>
                    <td className="n">{num(row.redeemed_count)}</td>
                    <td className="n">{num(row.max_redemptions)}</td>
                    <td>{day(row.expires_at)}</td>
                    <td className="wrap">{row.note || <span className="muted">—</span>}</td>
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
