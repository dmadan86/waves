import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/lib/site';
import { Button, Container, Kicker } from './ui';

const h2 = 'text-[1.35rem] font-bold tracking-[-0.025em] text-ink sm:text-[1.6rem]';

type T = Dictionary['companiesPage'];

/** "Get started in 3 steps" strip for the companies page. */
export function CompanySteps({ t }: { t: T['steps'] }) {
  return (
    <Container className="pb-10">
      <Kicker>{t.eyebrow}</Kicker>
      <h2 className={`${h2} mt-1.5`}>{t.title}</h2>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {t.items.map((s, i) => (
          <li
            key={s.title}
            className="flex gap-3 rounded-2xl bg-surface p-4 shadow-[var(--w-shadow-card)]"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-ink">
              {i + 1}
            </span>
            <div>
              <h3 className="text-[0.95rem] font-semibold text-ink">{s.title}</h3>
              <p className="mt-1 text-[0.86rem] leading-[1.5] text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
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
