import { getDictionary } from '@/i18n/dictionaries';
import { ogCard, ogSize } from '@/lib/og-card';

export const size = ogSize;
export const contentType = 'image/png';
export const alt = 'Waves for your own money';

export default async function OpengraphImage() {
  const p = (await getDictionary('en')).personalPage;
  return ogCard({ start: p.titleStart, accent: p.titleAccent, sub: p.subtitle });
}
