/** Pure formatting shared by the three entry cards. Templates belong to i18n. */
export function voiceEntryExamples(
  templates: readonly string[],
  currency: string,
  locale: string,
): string[] {
  const formatter = new Intl.NumberFormat(
    currency === 'INR' ? `${locale.split('-')[0]}-IN` : locale,
    {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    },
  );
  return templates.map(
    (template, index) =>
      `“${template.replace('{amount}', formatter.format([300, 15000, 2000][index] ?? 300))}”`,
  );
}
