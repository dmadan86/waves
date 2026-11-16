/** One row of the OTA adoption table: devices seen on a store version + OTA update. */
export interface AdoptionRow {
  platform: string;
  version: string;
  /** Short OTA update id, or null for the bundle built into the store binary. */
  update: string | null;
  devices: number;
}

/**
 * Count devices by platform, store version and OTA update. `app_version` is
 * `1.3.2` or `1.3.2+1a2b3c4d` (see mobile `versionWithUpdate`); `platform` is
 * `android 15`, so only its first word is kept. Newest version first.
 */
export function adoption(
  rows: { platform: string | null; app_version: string | null }[],
): AdoptionRow[] {
  const counts = new Map<string, AdoptionRow>();
  for (const row of rows) {
    const platform = (row.platform ?? 'unknown').split(' ')[0] || 'unknown';
    const [version = 'unknown', update = null] = (row.app_version || 'unknown').split('+');
    const key = `${platform}|${version}|${update}`;
    const hit = counts.get(key) ?? { platform, version, update, devices: 0 };
    hit.devices += 1;
    counts.set(key, hit);
  }
  const versionKey = (v: string) => v.split('.').map((n) => Number(n) || 0);
  return [...counts.values()].sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    const [x, y] = [versionKey(a.version), versionKey(b.version)];
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    }
    return b.devices - a.devices;
  });
}
