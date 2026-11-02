// Pure helpers behind the company switch (companiesEnabled.ts), kept free of react-native for tests.

/** The groups to show: company groups drop out when companies are off. Pure for tests. */
export function visibleGroups<T extends { type?: string | null }>(
  groups: readonly T[],
  companiesEnabled: boolean,
): T[] {
  return companiesEnabled ? [...groups] : groups.filter((group) => group.type !== 'company');
}

/** A route that only exists for companies (notification taps go Home instead when off). */
export function isCompanyRoute(path: string): boolean {
  return /^\/(companies|new-company)(\/|\?|$)|^\/group\/[^/]+\/company-/.test(path);
}
