/** Device bytes take precedence, including after a failed remote lookup. */
export function receiptDisplayUri(
  local: string | null,
  remote: string | null | undefined,
): string | null | undefined {
  return local ?? remote;
}
