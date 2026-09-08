'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { defaultLocale, isLocale, type Locale } from '@/i18n/config';
import { Wordmark } from './logo';
import { Button, Container } from './ui';

type Strings = Record<Locale, { title: string; body: string; back: string }>;

/**
 * The locale comes from the pathname rather than from the server, so a 404 on
 * `/ta/nope` arrives in Tamil without making every other page in the segment
 * server-rendered. See `not-found-strings.ts` for why that trade matters.
 */
export function NotFoundBody({ strings }: { strings: Strings }) {
  const pathname = usePathname();
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  const locale: Locale = isLocale(first) ? first : defaultLocale;
  const t = strings[locale];

  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen items-center">
      <Container className="text-center">
        <Link href={`/${locale}`} className="inline-flex rounded-sm">
          <Wordmark />
        </Link>

        <p aria-hidden="true" className="mt-14 font-pixel text-[4.5rem] leading-none text-ink-3">
          404
        </p>
        <h1 className="mt-5 text-balance text-[1.75rem] font-semibold tracking-[-0.03em] text-ink sm:text-[2.25rem]">
          {t.title}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-pretty text-[1.0625rem] leading-relaxed text-ink-2">
          {t.body}
        </p>

        <div className="mt-9 flex justify-center">
          <Button href={`/${locale}`}>{t.back}</Button>
        </div>
      </Container>
    </main>
  );
}
