'use client';

import { useState } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import { bestYearlySaving, plans, type PlanId } from '@/lib/plans';
import { Check, Crown, Wallet } from './icons';
import { site } from '@/lib/site';
import { Button, Kicker, SectionTitle } from './ui';

type Period = 'monthly' | 'yearly';

const tile: Record<PlanId, { Icon: typeof Wallet; color: string }> = {
  free: { Icon: Wallet, color: '#6f6ae8' },
  pro: { Icon: Crown, color: '#f59e0b' },
};

export function Pricing({ t }: { t: Dictionary['pricing'] }) {
  const [period, setPeriod] = useState<Period>('monthly');

  const periods: { id: Period; label: string }[] = [
    { id: 'monthly', label: t.monthly },
    { id: 'yearly', label: t.yearly },
  ];

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-10 lg:py-12">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Kicker>{t.eyebrow}</Kicker>
            <SectionTitle id="pricing-title" className="mt-2 max-w-[16rem] sm:max-w-none">
              {t.title}
            </SectionTitle>
          </div>
          <div
            role="group"
            aria-label={t.groupLabel}
            className="flex items-center gap-1 rounded-full bg-surface p-1 shadow-[var(--w-shadow-card)]"
          >
            {periods.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={period === p.id}
                onClick={() => setPeriod(p.id)}
                className={`inline-flex h-9 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors ${
                  period === p.id ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {p.label}
                {p.id === 'yearly' ? (
                  <span className={period === 'yearly' ? 'text-accent-ink/85' : 'text-blue'}>
                    {t.saveUpTo.replace('{pct}', String(bestYearlySaving))}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <ul aria-label={t.planLabel} className="mt-6 grid gap-4 md:grid-cols-2">
          {t.plans.map((plan) => {
            const id = plan.id as PlanId;
            const { Icon, color } = tile[id];
            // Pro is the one we recommend, so it carries the accent ring.
            const on = id === 'pro';
            const amount = plans[id][period];
            return (
              <li
                key={id}
                className={`relative flex flex-col rounded-[1.4rem] border-2 p-5 ${
                  on
                    ? 'border-accent bg-[color-mix(in_srgb,var(--w-accent)_7%,var(--w-surface))] shadow-[0_0_60px_-12px_var(--w-accent)]'
                    : 'border-transparent bg-surface shadow-[var(--w-shadow-card)]'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <span
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl"
                    style={{
                      background: `color-mix(in srgb, ${color} 15%, var(--w-surface))`,
                      color,
                    }}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="flex items-center gap-2 text-[1.15rem] font-semibold text-ink">
                      {plan.name}
                      {plan.badge ? (
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[0.62rem] font-semibold text-accent-ink">
                          {plan.badge}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[0.84rem] text-ink-3">{plan.tagline}</p>
                  </div>
                </div>

                <p className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-[2rem] leading-none font-bold tracking-[-0.03em] text-ink">
                    ₹{amount}
                  </span>
                  <span className="text-[0.85rem] text-ink-3">
                    {period === 'monthly' ? t.perMonth : t.perYear}
                  </span>
                  {period === 'yearly' && amount > 0 ? (
                    <span className="ms-2 text-[0.75rem] text-ink-3">{t.billedYearly}</span>
                  ) : null}
                </p>

                <ul className="mt-4 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-[0.9rem] text-ink">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
                        <Check className="h-3 w-3" />
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  href={site.appUrl}
                  external
                  variant={on ? 'primary' : 'secondary'}
                  className="mt-6 self-start"
                >
                  {on ? t.ctaPro : t.ctaFree}
                </Button>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 max-w-3xl text-[0.82rem] leading-relaxed text-ink-3">
          {t.freeNote} {t.priceNote}
        </p>
      </div>
    </section>
  );
}
