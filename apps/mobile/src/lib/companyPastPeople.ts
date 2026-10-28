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
  // Union-find over rows: any shared account / number / email links two rows,
  // including through a third (phone X, email Y, then both X and Y).
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const seen = new Map<string, number>();
  rows.forEach((row, i) => {
    for (const key of keysOf(row)) {
      const at = seen.get(key);
      if (at === undefined) seen.set(key, i);
      else parent[find(i)] = find(at);
    }
  });
  const groups = new Map<number, PastPersonRow[]>();
  rows.forEach((row, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), row]);
  });
  return [...groups.values()].map((members) => ({
    sourceMemberIds: members.map((row) => row.source_member_id),
    name: members[0]!.display_name,
    phone: members.find((row) => row.phone)?.phone ?? null,
    email: members.find((row) => row.email)?.email ?? null,
    companies: [...new Set(members.map((row) => row.source_group_name))],
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
