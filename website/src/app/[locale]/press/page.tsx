import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';

import { CompareShell, comparePageUrl } from '@/components/compare-page';
import { TrustList } from '@/components/marketing-blocks';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { socialMetadata } from '@/lib/compare-seo';
import { site } from '@/lib/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ locale: 'en' }];
}

const title = 'Waves press kit: logo, colours and facts';
const description =
  'Download the Waves logo, see brand colours and typefaces, and find short factual descriptions of the app for articles and listings.';

export const metadata: Metadata = socialMetadata({ title, description, path: '/press' });

const colours = [
  ['Waves violet', '#6C4EE3'],
  ['White', '#FFFFFF'],
  ['Ink (dark surface)', '#0D0E10'],
];

export default async function PressPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale) || locale !== 'en') notFound();
  const t = await getDictionary('en');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { name: 'Waves', path: '' },
          { name: 'Press kit', path: '/press' },
        ].map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: c.name,
          item: comparePageUrl(c.path),
        })),
      },
    ],
  };
  const h2 = 'text-[1.25rem] font-semibold tracking-[-0.02em] text-ink';
  const card = 'rounded-xl bg-surface px-4 py-3 shadow-[var(--w-shadow-sm)]';
  const btn =
    'inline-flex min-h-10 items-center rounded-sm border border-line-strong px-4 text-sm font-semibold text-ink hover:bg-chip';

  return (
    <CompareShell t={t} jsonLd={jsonLd}>
      <article className="mx-auto max-w-3xl pt-4">
        <p className="text-xs font-semibold tracking-[0.18em] text-blue uppercase">Press kit</p>
        <h1 className="mt-3 text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.08] font-bold tracking-[-0.04em] text-ink">
          Writing about Waves?
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-2">
          Everything here is free to use when you cover or link to Waves. For anything else, write
          to{' '}
          <a href={`mailto:${site.supportEmail}`} className="text-blue underline">
            {site.supportEmail}
          </a>
          .
        </p>

        <section className="mt-10" aria-labelledby="about-h">
          <h2 id="about-h" className={h2}>
            About Waves
          </h2>
          <p className={`${card} mt-3 text-[0.95rem] leading-[1.65] text-ink-2`}>
            Waves is a free app for splitting, tracking and settling shared expenses with friends,
            family and roommates. It runs on iOS, Android and the web, works offline, and hands
            the final payment to the payment app you already use, such as UPI. It also includes a
            personal money tracker and a Companies mode for small businesses. Waves is not a bank
            and never holds your money. The app is available in English, Hindi, Tamil and Arabic.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="logo-h">
          <h2 id="logo-h" className={h2}>
            Logo
          </h2>
          <div className={`${card} mt-3 flex flex-wrap items-center gap-6`}>
            <Image
              src="/brand/waves-mark.png"
              width={96}
              height={96}
              alt="The Waves logo: a white wave with a dot on a violet tile"
              className="rounded-[22%]"
            />
            <div className="flex flex-wrap gap-3">
              <a href="/brand/waves-mark.svg" download className={btn}>
                Download SVG
              </a>
              <a href="/brand/waves-mark.png" download className={btn}>
                Download PNG (512 px)
              </a>
              <a href="/en/opengraph-image" download="waves-share-card.png" className={btn}>
                Share card (1200 x 630)
              </a>
            </div>
          </div>
          <p className="mt-3 text-[0.85rem] text-ink-2">
            Please do not recolour, stretch or add effects to the logo, and leave clear space of
            about a quarter of its width around it.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="colour-h">
          <h2 id="colour-h" className={h2}>
            Colour and type
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {colours.map(([name, hex]) => (
              <li key={hex} className={`${card} flex items-center gap-3`}>
                <span
                  aria-hidden="true"
                  className="h-10 w-10 shrink-0 rounded-md border border-line"
                  style={{ background: hex }}
                />
                <span className="text-[0.9rem] text-ink">
                  {name}
                  <span className="block font-mono text-[0.78rem] text-ink-3">{hex}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.85rem] text-ink-2">
            Typefaces: Overused Grotesk for text and Departure Mono for the wordmark, both under
            the SIL Open Font License.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="shots-h">
          <h2 id="shots-h" className={h2}>
            Screenshots
          </h2>
          <Image
            src="/home/app-screens.webp"
            width={525}
            height={510}
            sizes="(max-width: 768px) 90vw, 525px"
            alt="Two Waves phone screens showing shared expense groups and a trip's balances with a settle-up button"
            className="mt-3 h-auto w-full max-w-[525px] rounded-xl"
          />
          <p className="mt-3 text-[0.85rem] text-ink-2">
            Need higher-resolution screenshots? Email us and we will send them.
          </p>
        </section>

        <TrustList />
      </article>
    </CompareShell>
  );
}
