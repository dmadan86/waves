import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';

/**
 * A catch-all whose only job is to fail.
 *
 * `not-found.tsx` inside a segment only renders when `notFound()` is actually
 * called inside that segment — so without this route, an unmatched URL fell
 * through to Next's built-in 404 page, which has no `lang`, no landmarks, no
 * stylesheet and no translation. This puts every miss back inside the locale
 * layout, where it gets all four.
 */
export default async function CatchAll({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  notFound();
}
