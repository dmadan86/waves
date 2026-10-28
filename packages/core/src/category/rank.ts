/** Frequency within the inclusive window; ties: latest, stars, input order. */
export function rankTags({
  keys,
  uses,
  now,
  windowDays = 90,
  starred = [],
}: {
  readonly keys: readonly string[];
  readonly uses: readonly { readonly key: string; readonly at: string | number }[];
  readonly now: number | Date;
  readonly windowDays?: number;
  readonly starred?: readonly string[];
}): string[] {
  const end = Number(now);
  const start = end - windowDays * 86_400_000;
  const stats = new Map<string, { count: number; latest: number }>();
  for (const use of uses) {
    const at = typeof use.at === 'number' ? use.at : Date.parse(use.at);
    if (!Number.isFinite(at) || at < start || at > end) continue;
    const prior = stats.get(use.key) ?? { count: 0, latest: -Infinity };
    stats.set(use.key, { count: prior.count + 1, latest: Math.max(at, prior.latest) });
  }
  const star = (key: string) => {
    const i = starred.indexOf(key);
    return i < 0 ? Infinity : i;
  };
  return keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => {
      const x = stats.get(a.key);
      const y = stats.get(b.key);
      return (
        (y?.count ?? 0) - (x?.count ?? 0) ||
        (y?.latest ?? -Infinity) - (x?.latest ?? -Infinity) ||
        star(a.key) - star(b.key) ||
        a.index - b.index
      );
    })
    .map(({ key }) => key);
}
