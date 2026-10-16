import type { Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { bestYearlySaving, plans, type PlanId } from './plans';
import { mcpEndpoint } from './mcp-tools';
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

  line(`# ${site.name} — ${t.hero.titleStart} ${t.hero.titleAccent}`);
  line();
  line(t.hero.subtitle);
  line();
  line(`- ${t.hero.trust.join('\n- ')}`);
  line();

  line(`## ${t.features.label}`);
  line();
  for (const item of t.features.items) line(`- **${item.title}** — ${item.body}`);
  line();

  line(`## ${t.how.title}`);
  line();
  line(t.how.subtitle);
  line();
  t.how.steps.forEach((step, i) => line(`${i + 1}. **${step.title}** — ${step.body}`));
  line();

  line(`## ${t.showcase.title.join(' ')}`);
  line();
  line(t.showcase.body);
  line();

  line(`## ${t.moments.title}`);
  line();
  for (const item of t.moments.items) line(`- **${item.title}** — ${item.body}`);
  line();

  line(`## ${t.offline.title}`);
  line();
  line(t.offline.body);
  line();
  for (const item of t.offline.scenarios) line(`- **${item.title}** — ${item.body}`);
  line();
  line(`- ${t.offline.points.join('\n- ')}`);
  line();
  line(`${t.offline.voiceTitle}. ${t.offline.voiceBody}`);
  line();

  line(`## ${t.voice.title}`);
  line();
  line(t.voice.body);
  line();
  for (const ex of t.voice.examples)
    line(`- “${ex.say}” → ${ex.title} ${ex.amount}, ${ex.lines.join(', ')}`);
  line();
  line(`- ${t.voice.points.join('\n- ')}`);
  line();
  line(t.voice.planLine);
  line();

  line(`## ${t.wearables.title}`);
  line();
  line(t.wearables.body);
  line();
  line(
    t.wearables.chips
      .map(
        (c) =>
          `${c.label} (${c.status === 'soon' ? t.wearables.soonLabel : t.wearables.availableLabel})`,
      )
      .join(' · '),
  );
  line();
  for (const ex of t.wearables.examples) line(`- **${ex.title}** (${ex.where}) — ${ex.body}`);
  line();
  line(`- ${t.wearables.points.join('\n- ')}`);
  line();
  line(t.wearables.soonNote);
  line();

  line(`## ${t.pricing.title}`);
  line();
  for (const plan of t.pricing.plans) {
    const price = plans[plan.id as PlanId];
    const badge = plan.badge ? ` (${plan.badge})` : '';
    line(
      price.monthly === 0
        ? `### ${plan.name}${badge} — ₹0`
        : `### ${plan.name}${badge} — ₹${price.monthly}${t.pricing.perMonth} · ₹${price.yearly}${t.pricing.perYear}`,
    );
    line();
    line(plan.tagline);
    line();
    for (const feature of plan.features) line(`- ${feature}`);
    line();
  }
  line(t.pricing.saveUpTo.replace('{pct}', String(bestYearlySaving)));
  line();
  line(`${t.pricing.freeNote} ${t.pricing.priceNote}`);
  line();

  line(`## ${t.privacy.title}`);
  line();
  line(t.privacy.body);
  line();
  line(`- ${t.privacy.pills.join('\n- ')}`);
  line();
  line(`${t.privacy.cta}: ${absoluteUrl(`/${locale}/privacy`)}`);
  line();

  line(`## ${t.agents.title}`);
  line();
  line(t.agents.body);
  line();
  for (const ex of t.agents.examples) line(`- “${ex.ask}” → ${ex.reply}`);
  line();
  line(`- ${t.agents.safety.join('\n- ')}`);
  line();
  line(`MCP: ${mcpEndpoint(site.appUrl)}`);
  line(`${t.agents.cta}: ${absoluteUrl(`/${locale}/mcp`)}`);
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
  line(
    `${t.footer.links.webApp}: ${site.appUrl} · ${t.footer.links.contact}: ${site.supportEmail}`,
  );
  line();

  return out.join('\n');
}
