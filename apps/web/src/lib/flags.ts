'use client';

/**
 * Feature flags in the browser: the same rule as the phone. The server hands
 * over each flag's configuration and `isEnabled` from @waves/core hashes the
 * profile id into the rollout, exactly as the database does. Off is the answer
 * for everything unknown: no session, a failed read, a flag that is not there.
 */

import { useEffect, useState } from 'react';

import { isEnabled, type FeatureFlag } from '@waves/core';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/waves';

let cached: Promise<FeatureFlag[]> | null = null;

function loadFlags(): Promise<FeatureFlag[]> {
  cached ??= (async () => {
    const { data, error } = await supabase
      .from('feature_flags')
      .select('key, enabled, rollout_percent, variants');
    if (error || !data) return [];
    return data.map((row) => ({
      key: row.key as string,
      enabled: row.enabled as boolean,
      rolloutPercent: row.rollout_percent as number,
      variants: row.variants as string[],
    }));
  })().catch(() => []);
  return cached;
}

export function useFlagEnabled(key: string): boolean {
  const { profileId } = useAuth();
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  useEffect(() => {
    let active = true;
    void loadFlags().then((rows) => {
      if (active) setFlags(rows);
    });
    return () => {
      active = false;
    };
  }, []);
  const flag = flags?.find((candidate) => candidate.key === key);
  return Boolean(profileId && flag && isEnabled(flag, profileId));
}
