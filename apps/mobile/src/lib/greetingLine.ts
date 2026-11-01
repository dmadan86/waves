import { shortPersonName } from '@/lib/shortPersonName';

/** "Good afternoon, Madan" — the first name after the comma; no name, no comma. Arabic takes its own comma. */
export function greetingLine(greeting: string, name: string | null | undefined, locale: string) {
  const first = name ? shortPersonName(name) : '';
  if (!first) return greeting;
  return `${greeting}${locale.startsWith('ar') ? '،' : ','} ${first}`;
}
