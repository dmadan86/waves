/**
 * "Paid to": who outside the split the money actually went to.
 *
 * A Home group's rent goes to a landlord, the car to a rental firm, the maid's
 * wages to the maid. None of them is a member, so none of them belongs in the
 * payers or the shares; this is a label on the version, free text, optional,
 * and never part of a balance. Available in every group type.
 *
 * On the wire it has three states, because an app build that predates the
 * field must not wipe it by editing:
 *   • absent / null  — "not sent": an edit carries the previous version's
 *                      payee forward; a new expense has none.
 *   • ''             — cleared on purpose.
 *   • any other text — trimmed, inner runs of whitespace collapsed, capped.
 */

/** The longest payee the ledger keeps (the database CHECK says the same). */
export const PAYEE_MAX_LENGTH = 80;

/**
 * A payee as stored and shown: trimmed, inner whitespace collapsed, capped to
 * {@link PAYEE_MAX_LENGTH} characters (code points, so an emoji or a Tamil
 * cluster is never split into half a character). Blank becomes null.
 */
export function cleanPayee(value: string | null | undefined): string | null {
  if (value == null) return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return null;
  const chars = Array.from(collapsed);
  return chars.length > PAYEE_MAX_LENGTH
    ? chars.slice(0, PAYEE_MAX_LENGTH).join('').trimEnd()
    : collapsed;
}

/**
 * The `p_payee` argument for `waves_apply_expense`: null when the caller sent
 * nothing (the server carries the old payee forward), '' when it was cleared,
 * the cleaned text otherwise.
 */
export function payeeArgument(value: string | null | undefined): string | null {
  if (value == null) return null;
  return cleanPayee(value) ?? '';
}

/**
 * The payee a new version ends up with, given what the write sent and what the
 * version it replaces had. The same rule the server applies, for the offline
 * mirror's optimistic row.
 */
export function resolvePayee(
  sent: string | null | undefined,
  previous: string | null | undefined,
): string | null {
  if (sent == null) return cleanPayee(previous);
  return cleanPayee(sent);
}
