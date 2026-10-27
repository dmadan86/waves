import type { CreditsStatus } from './adCreditsPure';

export function exportCreditsLabel(
  paid: boolean,
  status: CreditsStatus | null | undefined,
  template: string,
): string | null {
  if (paid || !status) return null;
  return template
    .replace(/\{cost\}/g, String(status.costs.export))
    .replace(/\{balance\}/g, String(status.credits));
}
