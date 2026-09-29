'use client';

import { useId, useRef, useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import { featureVisuals } from './feature-visuals';
import { Check, Compass, Handshake, Lock, OfflineBolt, Scan, Split } from './icons';
import { Container, Eyebrow, Lede, Section, SectionTitle } from './ui';

const kickerIcons = [Split, OfflineBolt, Compass, Scan, Handshake, Lock] as const;

export function Features({ t, visuals }: { t: Dictionary['features']; visuals: Dictionary['visuals'] }) {
  const [active, setActive] = useState(0);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const Visual = featureVisuals[active] ?? featureVisuals[0];
  const item = t.items[active];

  const focusTab = (index: number) => {
    const next = (index + t.items.length) % t.items.length;
    setActive(next);
    tabsRef.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward || event.key === 'ArrowDown') focusTab(index + 1);
    else if (event.key === back || event.key === 'ArrowUp') focusTab(index - 1);
    else if (event.key === 'Home') focusTab(0);
    else if (event.key === 'End') focusTab(t.items.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <Section id="features" className="lg:py-36">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow index="01">{t.eyebrow}</Eyebrow>
            <SectionTitle className="mt-5">{t.title}</SectionTitle>
            <Lede className="mt-5">{t.subtitle}</Lede>
            <p className="mt-8 font-mono text-[0.68rem] text-ink-3">Explore the product surface →</p>
          </div>

          <div>
            <div role="tablist" aria-label={t.tablistLabel} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {t.items.map((tab, index) => {
                const Icon = kickerIcons[index] ?? Split;
                const selected = index === active;
                return (
                  <button
                    key={tab.kicker}
                    ref={(node) => { tabsRef.current[index] = node; }}
                    type="button"
                    role="tab"
                    id={`${id}-tab-${index}`}
                    aria-selected={selected}
                    aria-controls={`${id}-panel-${index}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActive(index)}
                    onKeyDown={(event) => onKeyDown(event, index)}
                    className={`group flex min-h-16 items-center gap-3 rounded-2xl border px-4 text-start transition-all ${
                      selected ? 'border-accent/40 bg-accent-wash text-accent shadow-[var(--w-shadow-sm)]' : 'border-line bg-surface/60 text-ink-2 hover:border-line-strong hover:bg-surface'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="text-[0.86rem] font-medium">{tab.kicker}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-[1.5rem] border border-line bg-surface p-5 shadow-[var(--w-shadow-md)] sm:p-7">
              <div role="tabpanel" id={`${id}-panel-${active}`} aria-labelledby={`${id}-tab-${active}`} tabIndex={0}>
                <div className="grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr]">
                  <div>
                    <h3 className="text-balance text-[1.7rem] leading-[1.05] font-semibold tracking-[-0.04em] text-ink sm:text-[2.15rem]">{item.title}</h3>
                    <p className="mt-4 text-[0.94rem] leading-[1.7] text-ink-2">{item.body}</p>
                    <ul className="mt-6 space-y-2.5">
                      {item.points.map((point) => (
                        <li key={point} className="flex items-start gap-2.5 text-[0.84rem] text-ink-2">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="lg:ps-3"><Visual t={visuals} /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
