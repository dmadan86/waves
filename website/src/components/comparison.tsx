import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { checkedOnDate, COMPARISON_SOURCES } from '@/lib/comparison';
import { Check, Minus } from './icons';
import { Container, Eyebrow, Lede, Section, SectionTitle } from './ui';

/**
 * A comparison table is only worth having if every cell survives being checked
 * by somebody who works at the other company. Three rules hold this section
 * together, and breaking any one of them is worse than deleting the section:
 *
 * 1. Every claim about Splitwise comes from a page Splitwise publishes. Not a
 *    review site, not a listicle, not memory. The exact source and the date it
 *    was read are in SOURCES below; the visible "checked on" line carries the
 *    same date so a reader can tell how stale this is.
 * 2. A row that cannot be sourced is deleted, not softened. Expense search was
 *    dropped for the opposite reason — Splitwise puts it behind Pro, but Waves
 *    has no search at all, so the row would have flattered us by omission.
 * 3. The second group is rows where Splitwise is ahead. An all-green column is
 *    advertising, and one dishonest row costs the reader's belief in the other
 *    nine.
 *
 * SOURCES, all read 2026-09-08 (COMPARISON_CHECKED_ON):
 *
 *   Free plan, 4 expenses a day
 *     https://kb.splitwise.com/pro/what-is-splitwise-pro
 *     "Unlimited expenses: Add as many expenses as you need without hitting a
 *     limit (free users can add up to 4 expenses each day)."
 *
 *   Currency conversion is Pro
 *     https://kb.splitwise.com/pro/what-is-splitwise-pro
 *     "Only Pro subscribers can convert, but all group members will see
 *     expenses in their converted form."
 *
 *   Receipt scanning and itemisation is Pro
 *     https://kb.splitwise.com/pro/what-is-splitwise-pro
 *     "Only Pro subscribers can scan and itemize receipts."
 *
 *   Charts are Pro
 *     https://www.splitwise.com/pro — "Charts and graphs" is listed under Pro.
 *
 *   Ad-free is a Pro feature
 *     https://www.splitwise.com/pro — "Splitwise's most powerful features. No
 *     limits and no ads." and "A totally ad-free experience". The home page
 *     lists it under "Pro features", not "Core features". We say only that,
 *     and make no claim about what free users are shown.
 *
 *   7+ languages
 *     https://www.splitwise.com/ — "7+ languages", under "Core features".
 *
 *   Transaction import, Pro and US only
 *     https://www.splitwise.com/pro — "Connect a credit or debit card to see
 *     your recent purchases — then split with just a tap. (Currently available
 *     only in the US.)"
 *
 *   A developer API
 *     https://dev.splitwise.com/ — "Splitwise API", linked as "API" from the
 *     footer of every splitwise.com page.
 *
 *   Payment integrations
 *     https://www.splitwise.com/ — "Payment integrations", under "Core
 *     features".
 *
 *   Both do: unequal splits, splitting by percentage or shares, simplifying
 *   debts, and offline mode
 *     https://www.splitwise.com/ — all four under "Core features".
 *
 * The Waves column is held to the same bar. Nothing here needs a store rating,
 * a user count or an audit, because Waves is pre-launch and has none of the
 * three. "Free" means free today, not free once something ships: the trip-wide
 * exchange rate and the SMS importer are both built and both dark, so neither
 * appears in a cell.
 */

/**
 * The label is the URL with the scheme taken off, so it cannot drift from the
 * href — and the list itself is shared with the Markdown twin.
 */
const SOURCES = COMPARISON_SOURCES.map((href) => ({
  href,
  label: href.replace(/^https:\/\//, '').replace(/\/$/, ''),
}));

/**
 * A cell that is nothing but a figure — "4", "7+" — is its own left-to-right
 * run. In an Arabic table the "+" is a neutral character and the bidi
 * algorithm will happily move it to the far side of the digits. A cell with
 * letters in it is left alone, because isolating that would break the Arabic.
 * Prior art: ledger-card.tsx.
 */
const FIGURE_ONLY = /^[\d\s.,+-]+$/;

function Cell({
  value,
  note,
  included,
  notIncluded,
}: {
  value: string | boolean;
  note: string;
  included: string;
  notIncluded: string;
}) {
  return (
    <td className="py-3.5 text-center align-top">
      {value === true ? (
        <>
          <Check className="mx-auto h-4 w-4 text-accent" aria-hidden="true" />
          <span className="sr-only">{included}</span>
        </>
      ) : value === false ? (
        <>
          <Minus className="mx-auto h-4 w-4 text-ink-3/50" aria-hidden="true" />
          <span className="sr-only">{notIncluded}</span>
        </>
      ) : FIGURE_ONLY.test(value) ? (
        <span
          dir="ltr"
          className="font-mono tabular text-[0.8125rem] text-ink [unicode-bidi:isolate]"
        >
          {value}
        </span>
      ) : (
        <span className="font-mono text-[0.8125rem] text-ink">{value}</span>
      )}

      {note ? (
        <span className="mt-1 block text-[0.75rem] leading-snug text-ink-3">{note}</span>
      ) : null}
    </td>
  );
}

export function Comparison({ t, locale }: { t: Dictionary['comparison']; locale: Locale }) {
  return (
    <Section id="comparison">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow index="06">{t.eyebrow}</Eyebrow>
          <SectionTitle className="mt-5">{t.title}</SectionTitle>
          <Lede className="mt-4">{t.subtitle}</Lede>
          {/* The date is the whole point of the line: a comparison nobody can
              date is a comparison nobody can check. Set in the prose face
              rather than the mono, because the mono is Latin-only and this
              sentence is translated. */}
          <p className="mt-5 text-[0.8125rem] leading-relaxed text-ink-3">
            {t.checkedOn.replace('{date}', checkedOnDate(locale))}
          </p>
        </div>

        <div className="mt-12 space-y-12">
          {t.groups.map((group) => (
            /* Wider than a phone, so the scroller is a keyboard stop with a
               name — otherwise the far column is reachable only with a
               mouse. The caption is that name, and it is the whole labelling
               job this section does: "where Splitwise is ahead" has to be
               readable, not inferred from which column has the ticks. */
            <div
              key={group.caption}
              tabIndex={0}
              role="group"
              aria-label={group.caption}
              className="overflow-x-auto"
            >
              {/* Narrower than the pricing table's 34rem on purpose: at that
                  width a phone shows the Waves column and nothing of
                  Splitwise, and a comparison whose second column is invisible
                  reads as a feature list. At 30rem the far column is clipped
                  rather than absent, which is its own affordance. */}
              <table className="w-full min-w-[30rem] border-collapse text-start">
                <caption className="pb-4 text-start text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">
                  {group.caption}
                </caption>
                <thead>
                  <tr className="border-y border-line">
                    <th
                      scope="col"
                      className="py-2.5 pe-4 text-start text-[0.8125rem] font-medium text-ink-2"
                    >
                      {t.columns.feature}
                    </th>
                    <th
                      scope="col"
                      className="w-[22%] py-2.5 text-center font-mono text-[0.75rem] font-normal tracking-[0.06em] text-ink uppercase"
                    >
                      {t.columns.waves}
                    </th>
                    <th
                      scope="col"
                      className="w-[26%] py-2.5 text-center font-mono text-[0.75rem] font-normal tracking-[0.06em] text-ink-2 uppercase"
                    >
                      {t.columns.rival}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {group.rows.map((row) => (
                    <tr key={row.label}>
                      <th
                        scope="row"
                        className="py-3.5 pe-4 text-start text-[0.875rem] font-normal text-ink"
                      >
                        {row.label}
                      </th>
                      <Cell
                        value={row.waves}
                        note={row.wavesNote}
                        included={t.included}
                        notIncluded={t.notIncluded}
                      />
                      <Cell
                        value={row.rival}
                        note={row.rivalNote}
                        included={t.included}
                        notIncluded={t.notIncluded}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="mt-12 grid gap-8 border-t border-line pt-8 md:grid-cols-2">
          <div>
            <h3 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
              {t.sameTitle}
            </h3>
            <p className="mt-2.5 max-w-md text-[0.875rem] leading-relaxed text-ink-2">{t.same}</p>
          </div>

          <div>
            <h3 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
              {t.sourcesTitle}
            </h3>
            <p className="mt-2.5 max-w-md text-[0.875rem] leading-relaxed text-ink-2">
              {t.sourcesBody}
            </p>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {SOURCES.map((source) => (
                <li key={source.href}>
                  <a
                    href={source.href}
                    dir="ltr"
                    rel="noreferrer nofollow"
                    className="rounded-xs font-mono text-[0.75rem] text-ink-2 underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-accent [unicode-bidi:isolate]"
                  >
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-8 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-3">{t.footnote}</p>
      </Container>
    </Section>
  );
}
