/**
 * What currency a budget's amount is in.
 *
 * One line, and it lives here because getting it wrong is not cosmetic.
 *
 * A budget keeps its own currency; the database allows it to differ from the
 * group's default, and the edit field is prefilled in the budget's. Parse that
 * text against the group's default instead and the wrong minor-unit exponent is
 * applied: a ¥15,000 cap prefills as "15000", and read as rupees that is
 * ₹15,000 — 1,500,000 minor units where the row held 15,000. A hundredfold
 * error, saved under a denomination nobody chose, with nothing on screen to
 * suggest anything happened.
 *
 * So: an existing budget answers with its own; only a new one takes the
 * group's.
 */
export function budgetDenomination(
  budget: { readonly currency: string } | null | undefined,
  groupCurrency: string,
): string {
  return budget?.currency ?? groupCurrency;
}
