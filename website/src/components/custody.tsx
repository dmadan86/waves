import type { Dictionary } from '@/i18n/dictionaries';
import { Lock, Wallet } from './icons';
import { Container } from './ui';

export function Custody({ t }: { t: Dictionary['custody'] }) {
  return (
    <section className="border-b border-line bg-paper">
      <Container>
        <div className="grid gap-8 py-10 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-8 sm:py-12">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-wash text-accent">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[1.05rem] font-semibold tracking-[-0.02em] text-ink sm:text-[1.25rem]">{t.claim}</p>
            <p className="mt-1.5 max-w-3xl text-[0.9rem] leading-relaxed text-ink-2">{t.body}</p>
          </div>
          <div className="flex items-center gap-2 font-mono text-[0.68rem] text-ink-3 sm:max-w-xs sm:flex-wrap sm:justify-end">
            <Lock className="h-3.5 w-3.5 text-accent" />
            {t.rails.map((rail) => <span key={rail} className="rounded-full border border-line px-2 py-1">{rail}</span>)}
          </div>
        </div>
      </Container>
    </section>
  );
}
