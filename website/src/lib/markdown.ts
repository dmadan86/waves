import type { Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { CURRENCY_COUNT } from './currencies';
import { absoluteUrl, site } from './site';

/**
 * The page, as prose.
 *
 * A landing page is mostly layout; a language model reading it gets a fraction
 * of the meaning for many times the tokens. Every site whose docs get quoted
 * well — Ramp, Clerk, Resend, and in this category Tricount — serves a
 * markdown twin, and this is ours. It is generated from the same dictionary
 * the page renders from, so it cannot drift out of date and it exists in all
 * four languages.
 */
export async function pageAsMarkdown(locale: Locale): Promise<string> {
  const t = await getDictionary(locale);
  const out: string[] = [];
  const line = (s = '') => out.push(s);

  line('---');
  line(`title: ${t.meta.title}`);
  line(`description: ${t.meta.description}`);
  line(`url: ${absoluteUrl(`/${locale}`)}`);
  line(`language: ${locale}`);
  line('---');
  line();

  line(`# ${site.name} — ${t.hero.titleLine1} ${t.hero.titleAccent}`);
  line();
  line(t.hero.subtitle);
  line();
  line(`- ${t.hero.facts.join('\n- ')}`);
  line();

  line(`## ${t.custody.claim}`);
  line();
  line(t.custody.body);
  line();
  line(`Settles through, for example: ${t.custody.rails.join(', ')}.`);
  line();

  line(`## ${t.features.title}`);
  line();
  line(t.features.subtitle);
  line();
  for (const item of t.features.items) {
    line(`### ${item.title}`);
    line();
    line(item.body);
    line();
    line(`- ${item.points.join('\n- ')}`);
    line();
  }

  line(`## ${t.currencies.title}`);
  line();
  line(t.currencies.subtitle);
  line();
  line(`${CURRENCY_COUNT} currencies, every active ISO 4217 code. ${t.currencies.note}`);
  line();

  line(`## ${t.how.title}`);
  line();
  for (const step of t.how.steps) {
    line(`${step.number}. **${step.title}** — ${step.body}`);
  }
  line();
  line(`### ${t.how.example.label}`);
  line();
  line(t.how.example.setup);
  line();
  for (const expense of t.how.example.expenses) {
    line(`- ${expense.what} — ${expense.amount} (${expense.who})`);
  }
  line();
  line(`**${t.how.example.resultLabel}**`);
  line();
  for (const payment of t.how.example.payments) {
    line(`- ${payment.line} — ${payment.amount}`);
  }
  line();
  line(t.how.example.note);
  line();

  line(`## ${t.privacy.title}`);
  line();
  line(t.privacy.body);
  line();
  for (const [heading, items] of [
    [t.privacy.cantTitle, t.privacy.cant],
    [t.privacy.doesTitle, t.privacy.does],
    [t.privacy.wontTitle, t.privacy.wont],
  ] as const) {
    line(`### ${heading}`);
    line();
    for (const item of items) line(`- **${item.title}** — ${item.body}`);
    line();
  }
  line(t.privacy.footnote);
  line();

  line(`## ${t.pricing.title}`);
  line();
  line(t.pricing.subtitle);
  line();
  for (const plan of t.pricing.plans) {
    line(`### ${plan.name} — ${plan.price}${plan.period ? ` ${plan.period}` : ''}`);
    line();
    line(plan.tagline);
    line();
    if (plan.inherits) line(`- ${plan.inherits}`);
    line(`- ${plan.features.join('\n- ')}`);
    line();
  }
  line(t.pricing.billedNote);
  line();

  line(`## ${t.faq.title}`);
  line();
  for (const item of t.faq.items) {
    line(`### ${item.q}`);
    line();
    line(item.a);
    line();
  }

  line('---');
  line();
  line(`${t.footer.tagline} ${t.footer.notABank}`);
  line(`Web app: ${site.appUrl} · Contact: ${site.supportEmail}`);
  line();

  return out.join('\n');
}
