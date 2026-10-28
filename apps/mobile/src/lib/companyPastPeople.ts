/**
 * "From a previous company": the rows `waves_company_past_people` returns are
 * one per membership, so the same person in two of the admin's companies comes
 * back twice. This folds them into one tickable person (same account, number or
 * email) that remembers every company it came from, and filters by a search.
 * The server decides who may appear at all; nothing here widens that.
 */

import { digitsOf, fold } from '@/lib/contactMatch';

export interface PastPersonRow {
  source_group_id: string;
  source_group_name: string;
  source_member_id: string;
  profile_id: string | null;
  display_name: string;
  phone: string | null;
  email: string | null;
  is_placeholder: boolean;
}

export interface PastPerson {
  /** Every source membership folded into this person; the add RPC takes these. */
  readonly sourceMemberIds: readonly string[];
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly companies: readonly string[];
}

const keysOf = (row: PastPersonRow): string[] => {
  const keys: string[] = [];
  if (row.profile_id) keys.push(`p:${row.profile_id}`);
  const digits = row.phone ? digitsOf(row.phone) : '';
  if (digits) keys.push(`t:${digits}`);
  const email = row.email?.trim().toLowerCase();
  if (email) keys.push(`e:${email}`);
  return keys;
};

export function foldPastPeople(rows: readonly PastPersonRow[]): PastPerson[] {
  const people: {
    ids: string[];
    name: string;
    phone: string | null;
    email: string | null;
    companies: string[];
  }[] = [];
  const byKey = new Map<string, number>();
  for (const row of rows) {
    const keys = keysOf(row);
    const at = keys.map((key) => byKey.get(key)).find((index) => index !== undefined);
    let index = at;
    if (index === undefined) {
      index = people.length;
      people.push({
        ids: [],
        name: row.display_name,
        phone: row.phone,
        email: row.email,
        companies: [],
      });
    }
    const person = people[index]!;
    person.ids.push(row.source_member_id);
    person.phone ??= row.phone;
    person.email ??= row.email;
    if (!person.companies.includes(row.source_group_name)) {
      person.companies.push(row.source_group_name);
    }
    for (const key of keys) byKey.set(key, index);
  }
  return people.map((person) => ({
    sourceMemberIds: person.ids,
    name: person.name,
    phone: person.phone,
    email: person.email,
    companies: person.companies,
  }));
}

export function searchPastPeople(people: readonly PastPerson[], query: string): PastPerson[] {
  const needle = fold(query);
  const digits = digitsOf(query);
  if (!needle && !digits) return [...people];
  return people.filter(
    (person) =>
      fold(person.name).includes(needle) ||
      person.companies.some((company) => fold(company).includes(needle)) ||
      (person.email ?? '').toLowerCase().includes(query.trim().toLowerCase()) ||
      (digits.length > 2 && digitsOf(person.phone ?? '').includes(digits)),
  );
}
