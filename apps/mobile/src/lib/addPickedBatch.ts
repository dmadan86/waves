/**
 * Add several picked people one call each (the server takes one member per
 * request, so batching would only hide which of them failed). A failure
 * part-way does not undo the ones already in: the report is which names did
 * not make it, keeping the first refusal's words so the message can say why.
 */

export interface PickedPerson {
  name: string;
  email?: string | null;
  phone?: string | null;
}

export async function addPickedBatch(
  people: readonly PickedPerson[],
  add: (person: PickedPerson) => Promise<unknown>,
  describeError: (caught: unknown) => string,
): Promise<{ failed: string[]; reason: string }> {
  const failed: string[] = [];
  let reason: string | null = null;
  for (const person of people) {
    try {
      await add({ name: person.name, email: person.email, phone: person.phone });
    } catch (caught) {
      failed.push(person.name);
      const message = describeError(caught);
      if (!reason) reason = message;
    }
  }
  return { failed, reason: reason ?? '' };
}
