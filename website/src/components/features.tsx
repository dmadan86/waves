'use client';

import { useId, useRef, useState } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import { featureVisuals } from './feature-visuals';
import { Check, Compass, Handshake, Lock, OfflineBolt, Scan, Split } from './icons';
import { Container, Eyebrow, Lede, Section, SectionTitle } from './ui';

const kickerIcons = [Split, OfflineBolt, Compass, Scan, Handshake, Lock] as const;

/**
 * Six features used to be six full-height alternating rows — roughly four
 * thousand pixels of scroll in which every row had the same shape. They are now
 * one tab set over one visual, which is both shorter and more useful: the
 * visitor picks what they came to check instead of scrolling past five things
 * they didn't.
 *
 * It is the real ARIA tabs pattern rather than a set of buttons — roving
 * tabindex, arrow keys that follow the writing direction, Home and End — so a
 * keyboard user moves through it the way the pattern promises.
 */
export function Features({
  t,
  visuals,
}: {
  t: Dictionary['features'];
  visuals: Dictionary['visuals'];
}) {
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
    <Section id="features">
      <Container>
        <div className="max-w-3xl">
          <Eyebrow index="01">{t.eyebrow}</Eyebrow>
          <SectionTitle className="mt-5">{t.title}</SectionTitle>
          <Lede className="mt-4">{t.subtitle}</Lede>
        </div>

        {/* The tab strip scrolls rather than wraps, so the row never becomes
            two rows of different lengths at an awkward width. It needs no
            tabindex of its own: every tab in it is already a keyboard stop, and
            focusing one scrolls it into view. */}
        <div
          role="tablist"
          aria-label={t.tablistLabel}
          className="-mx-5 mt-10 flex gap-1 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {t.items.map((tab, index) => {
            const Icon = kickerIcons[index] ?? Split;
            const selected = index === active;
            return (
              <button
                key={tab.kicker}
                ref={(node) => {
                  tabsRef.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${index}`}
                aria-selected={selected}
                aria-controls={`${id}-panel-${index}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-md px-3.5 text-sm whitespace-nowrap transition-colors duration-150 ${
                  selected ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-chip hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.kicker}
              </button>
            );
          })}
        </div>

        {t.items.map((_, index) => (
          <div
            key={index}
            role="tabpanel"
            id={`${id}-panel-${index}`}
            aria-labelledby={`${id}-tab-${index}`}
            hidden={index !== active}
            tabIndex={0}
            className="mt-8 rounded-xl focus-visible:outline-2"
          >
            {index === active ? (
              <div className="grid items-center gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
                <div>
                  <h3 className="text-balance text-[1.5rem] leading-[1.15] font-semibold tracking-[-0.025em] text-ink sm:text-[1.875rem]">
                    {item.title}
                  </h3>
                  <p className="mt-3.5 max-w-lg text-pretty text-[0.9375rem] leading-[1.65] text-ink-2">
                    {item.body}
                  </p>
                  <ul className="mt-6 space-y-2.5">
                    {item.points.map((point) => (
                      <li
                        key={point}
                        className="flex items-start gap-2.5 text-[0.875rem] text-ink-2"
                      >
                        <Check
                          className="mt-[0.2rem] h-3.5 w-3.5 shrink-0 text-accent"
                          aria-hidden="true"
                        />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="lg:ps-6">
                  <Visual t={visuals} />
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </Container>
    </Section>
  );
}
