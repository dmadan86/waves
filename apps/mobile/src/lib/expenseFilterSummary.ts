/** What the Expenses filter pill says: "Filter" by default, else the active choices, two at most. */
export function filterPillText(
  parts: readonly (string | null | false)[],
  fallback: string,
): { text: string; active: boolean } {
  const on = parts.filter((p): p is string => !!p);
  if (on.length === 0) return { text: fallback, active: false };
  const text = on.slice(0, 2).join(' · ');
  return { text: on.length > 2 ? `${text} +${on.length - 2}` : text, active: true };
}
