/**
 * This build's identity, read off the running binary.
 *
 * Split from `lib/buildStamp` (which only formats it) because reading it needs
 * `expo-constants` and React Native's `Platform`, and the mobile test run can
 * load neither — so the half worth testing stays testable.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { type BuildIdentity, formatBuildStamp } from './buildStamp';

/** Version, build number and commit, as this binary was configured. */
export function buildIdentity(): BuildIdentity {
  const config = Constants.expoConfig;
  const build =
    Platform.OS === 'ios' ? config?.ios?.buildNumber : config?.android?.versionCode?.toString();
  const commit = (config?.extra as { commit?: unknown } | undefined)?.commit;

  return {
    version: config?.version ?? null,
    build: build ?? null,
    commit: typeof commit === 'string' ? commit : null,
  };
}

/** The line Settings renders. */
export function buildStamp(): string {
  return formatBuildStamp(buildIdentity());
}
