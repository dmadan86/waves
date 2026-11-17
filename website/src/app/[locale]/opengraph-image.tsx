import { getDictionary } from '@/i18n/dictionaries';
import { ogCard, ogSize } from '@/lib/og-card';

export const size = ogSize;
export const contentType = 'image/png';
export const alt = 'Waves — split bills with friends, settle up in seconds';

export default async function OpengraphImage() {
  const t = await getDictionary('en');
  return ogCard({
    start: t.hero.titleStart,
    accent: t.hero.titleAccent,
    sub: 'Split, track and settle. Opens UPI with the exact amount. Waves never holds your money.',
  });
}
