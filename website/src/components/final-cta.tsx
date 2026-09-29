import type { Dictionary } from '@/i18n/dictionaries';
import { StoreBadges } from './store-badges';
import { Button, Container } from './ui';

export function FinalCta({ t, stores, appUrl }: { t: Dictionary['cta']; stores: Dictionary['hero']['stores']; appUrl: string }) {
  return (
    <section className="relative overflow-hidden border-y border-line py-24 sm:py-32 lg:py-40">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgb(122_90_248_/_0.18),transparent_52%)]" />
      <Container>
        <div className="relative mx-auto max-w-4xl rounded-[2rem] border border-white/10 bg-[#171321] px-6 py-14 text-center shadow-[var(--w-shadow-lg)] sm:px-12 sm:py-20">
          <p className="font-mono text-[0.68rem] tracking-[0.14em] text-brand-300 uppercase">Waves</p>
          <h2 className="mx-auto mt-5 max-w-3xl text-balance text-[2.8rem] leading-[0.98] font-semibold tracking-[-0.055em] text-white sm:text-[4.8rem]">{t.title}</h2>
          <p className="mx-auto mt-6 max-w-xl text-[1rem] leading-[1.7] text-white/60">{t.subtitle}</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href={appUrl} external size="lg">{t.primary}</Button>
            <Button href={appUrl} external variant="quiet" size="lg" className="text-white/60 hover:bg-white/8 hover:text-white">{t.secondary}</Button>
          </div>
          <div className="mt-6 flex justify-center"><StoreBadges t={stores} linksOnly /></div>
          <p className="mt-7 font-mono text-[0.68rem] text-white/35">{t.note}</p>
        </div>
      </Container>
    </section>
  );
}
