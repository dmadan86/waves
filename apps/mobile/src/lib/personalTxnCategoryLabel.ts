import { incomeSource } from '@waves/core';

export function personalTxnCategoryLabel(
  id: string | null,
  translated: (id: string) => string | null,
): string | null {
  if (!id) return null;
  const label = translated(id);
  if (label) return label;
  if (id.startsWith('inc.')) return incomeSource(id)?.label ?? null;
  if (id.startsWith('inv.')) return id === 'inv.deposit' ? 'Investment deposit' : 'Investment';
  return null;
}
