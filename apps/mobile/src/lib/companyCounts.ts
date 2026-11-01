import { plural, type PluralForms } from '@/i18n';

/** "6 employees · 2 managers · 1 owner": zero parts are left out. */
export function companyCountsLine(
  locale: string,
  n: { employees: number; managers: number; owners: number },
  forms: { employees: PluralForms; managers: PluralForms; owners: PluralForms },
): string {
  return (
    [
      [n.employees, forms.employees],
      [n.managers, forms.managers],
      [n.owners, forms.owners],
    ] as const
  )
    .filter(([c]) => c > 0)
    .map(([c, f]) => plural(locale, c, f))
    .join(' · ');
}
