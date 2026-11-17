import { Fragment } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/lib/site';
import { ArrowRight } from './icons';
import { IconBadge, type IconName } from './line-icon';
import { Button, Container, Kicker } from './ui';

const h2 = 'text-[1.35rem] font-bold tracking-[-0.025em] text-ink sm:text-[1.6rem]';

type T = Dictionary['companiesPage'];

const STEP_ICONS: IconName[] = ['building', 'personPlus', 'checkCircle'];

/** "Get started in 3 steps" band for the companies page. */
export function CompanySteps({ t }: { t: T['steps'] }) {
  return (
    <Container className="pb-10">
      <div className="grid items-center gap-5 rounded-[2rem] bg-accent-wash p-5 sm:p-7 lg:grid-cols-[0.85fr_2fr] lg:gap-7">
        <div>
          <Kicker>{t.eyebrow}</Kicker>
          <h3 className="mt-1.5 text-balance text-[1.4rem] leading-[1.2] font-bold tracking-[-0.02em] text-ink sm:text-[1.7rem]">
            {t.title}
          </h3>
          <p className="mt-2 text-[0.92rem] leading-[1.6] text-ink-2">{t.lead}</p>
        </div>
        <ol className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          {t.items.map((s, i) => (
            <Fragment key={s.title}>
              {i > 0 ? (
                <li
                  aria-hidden="true"
                  className="hidden items-center text-accent lg:flex"
                  role="presentation"
                >
                  <ArrowRight className="h-5 w-5 rtl:-scale-x-100" />
                </li>
              ) : null}
              <li className="rounded-3xl bg-surface p-4 shadow-[var(--w-shadow-card)]">
                <div className="flex items-center justify-between">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-[0.75rem] font-bold text-accent-ink">
                    {i + 1}
                  </span>
                  <IconBadge name={STEP_ICONS[i] ?? 'check'} />
                </div>
                <h4 className="mt-3 text-[0.98rem] font-bold text-ink">{s.title}</h4>
                <p className="mt-1 text-[0.84rem] leading-[1.5] text-ink-2">{s.body}</p>
              </li>
            </Fragment>
          ))}
        </ol>
      </div>
    </Container>
  );
}

/** Owners' first objections, answered from what the app does. Native details: works without JS. */
export function CompanyFaq({ t }: { t: T['faq'] }) {
  return (
    <Container className="pb-10">
      <h2 className={h2}>{t.title}</h2>
      <div className="mt-4 grid items-start gap-3 md:grid-cols-2">
        {t.items.map((item) => (
          <details
            key={item.q}
            className="group rounded-2xl bg-surface shadow-[var(--w-shadow-card)]"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 text-start text-[0.93rem] font-medium text-ink [&::-webkit-details-marker]:hidden">
              {item.q}
              <span
                aria-hidden="true"
                className="text-ink-3 transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="px-5 pb-4 text-[0.88rem] leading-[1.6] text-ink-2">{item.a}</p>
          </details>
        ))}
      </div>
    </Container>
  );
}

/**
 * Sales contact. WhatsApp shows only when NEXT_PUBLIC_SALES_WHATSAPP is set;
 * the email button uses the support address already in site config.
 */
export function CompanyContact({ t }: { t: T['contact'] }) {
  const wa = site.salesWhatsapp.replace(/\D/g, '');
  const mail = `mailto:${site.supportEmail}?subject=${encodeURIComponent(t.emailSubject)}`;
  return (
    <Container className="pb-10">
      <section
        id="contact"
        aria-labelledby="contact-title"
        className="scroll-mt-24 rounded-2xl bg-surface p-6 shadow-[var(--w-shadow-card)] sm:p-8"
      >
        <h2 id="contact-title" className={h2}>
          {t.title}
        </h2>
        <p className="mt-2 max-w-2xl text-[0.92rem] leading-[1.6] text-ink-2">{t.body}</p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {wa ? (
            <Button
              href={`https://wa.me/${wa}?text=${encodeURIComponent(t.whatsappText)}`}
              external
              size="lg"
            >
              {t.whatsapp}
            </Button>
          ) : null}
          <Button href={mail} external size="lg" variant={wa ? 'secondary' : 'primary'} arrow={!wa}>
            {t.email}
          </Button>
        </div>
      </section>
    </Container>
  );
}
