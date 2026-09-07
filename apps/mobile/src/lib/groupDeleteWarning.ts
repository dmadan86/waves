export const MAX_DELETE_DEBT_LINES = 4;

interface PluralForms {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export interface GroupDeleteWarningStrings {
  readonly deleteBody: string;
  readonly deleteUnsettledIntro: string;
  readonly deleteUnsettledWarning: string;
  readonly deleteMoreDebts: PluralForms;
}

function selectRule(locale: string, count: number): Intl.LDMLPluralRule {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  if (language === 'ar') {
    const mod100 = count % 100;
    if (count === 0) return 'zero';
    if (count === 1) return 'one';
    if (count === 2) return 'two';
    if (mod100 >= 3 && mod100 <= 10) return 'few';
    if (mod100 >= 11 && mod100 <= 99) return 'many';
  }
  if (language === 'hi') return count === 0 || count === 1 ? 'one' : 'other';
  return count === 1 ? 'one' : 'other';
}

function formatCount(locale: string, count: number): string {
  try {
    return new Intl.NumberFormat(locale).format(count);
  } catch {
    return String(count);
  }
}

function plural(locale: string, count: number, forms: PluralForms): string {
  const rule = selectRule(locale, count);
  return (forms[rule] ?? forms.other).replaceAll('{n}', formatCount(locale, count));
}

export function groupDeleteBody(params: {
  readonly groupSettled: boolean;
  readonly debtLines: readonly string[];
  readonly locale: string;
  readonly text: GroupDeleteWarningStrings;
}): string {
  if (params.groupSettled) return params.text.deleteBody;

  const shown = params.debtLines.slice(0, MAX_DELETE_DEBT_LINES);
  return [
    params.text.deleteBody,
    '',
    params.text.deleteUnsettledIntro,
    ...shown,
    ...(params.debtLines.length > shown.length
      ? [plural(params.locale, params.debtLines.length - shown.length, params.text.deleteMoreDebts)]
      : []),
    '',
    params.text.deleteUnsettledWarning,
  ].join('\n');
}
