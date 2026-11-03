import { buildReimbursementPreview, isReimbursable, type CompanyEntry } from '@waves/core';

/** What paying every approved, unpaid claim records: advances and credits come off, never below zero. */
export function employeeDue(
  entries: readonly CompanyEntry[],
  memberId: string,
): { due: CompanyEntry[]; total: bigint } {
  const due = entries
    .filter((e) => !e.paidByCompany && e.memberId === memberId && isReimbursable(e))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  const net = buildReimbursementPreview(entries, {
    memberId,
    ids: due.map((e) => e.id),
  }).payoutMinor;
  return { due, total: net < 0n ? 0n : net };
}
