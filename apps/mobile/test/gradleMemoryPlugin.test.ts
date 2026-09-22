/**
 * The build-speed settings, and the one thing that can silently undo them.
 *
 * `prebuild` rewrites `android/gradle.properties` from Expo's template, so any
 * of these raised by hand lasts exactly until the next prebuild — which is why
 * they live in a plugin at all. Expo's own template already carries
 * `org.gradle.jvmargs` (and `org.gradle.parallel`), so the plugin's real job is
 * not appending: it is making sure the template's value is gone rather than
 * sitting in the same file as ours.
 */

import { describe, expect, it } from 'vitest';

type Item = { type: string; key?: string; value?: string };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withGradleMemory = require('../plugins/withGradleMemory.js') as ((c: unknown) => unknown) & {
  _internals: {
    PROPERTIES: Record<string, string>;
    applyProperties: (items: Item[]) => Item[];
  };
};

const { PROPERTIES, applyProperties } = withGradleMemory._internals;

const valueOf = (items: Item[], key: string): string | undefined =>
  items.find((i) => i.type === 'property' && i.key === key)?.value;

const countOf = (items: Item[], key: string): number =>
  items.filter((i) => i.type === 'property' && i.key === key).length;

/** `gradle.properties` as Expo's template hands it over: comments, and its own
 *  jvmargs and parallel already set to values we mean to replace. */
const template = (): Item[] => [
  { type: 'comment', value: 'Specifies the JVM arguments used for the daemon process.' },
  { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m' },
  { type: 'property', key: 'org.gradle.parallel', value: 'true' },
  { type: 'property', key: 'android.useAndroidX', value: 'true' },
  { type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a' },
];

describe('the gradle build-speed properties', () => {
  it('sets every property it owns', () => {
    const out = applyProperties(template());
    for (const [key, value] of Object.entries(PROPERTIES)) {
      expect(valueOf(out, key)).toBe(value);
    }
  });

  it('leaves no second copy of a key the template already had', () => {
    const out = applyProperties(template());
    // The template's 2 GiB heap is the one that must not survive: two jvmargs
    // lines in one file is how a build ends up with whichever Gradle read last.
    expect(countOf(out, 'org.gradle.jvmargs')).toBe(1);
    expect(countOf(out, 'org.gradle.parallel')).toBe(1);
  });

  it('touches nothing else in the file', () => {
    const out = applyProperties(template());
    expect(valueOf(out, 'android.useAndroidX')).toBe('true');
    expect(valueOf(out, 'reactNativeArchitectures')).toBe('armeabi-v7a,arm64-v8a');
    expect(out.filter((i) => i.type === 'comment')).toHaveLength(1);
  });

  it('is idempotent, so a second prebuild does not stack duplicates', () => {
    const once = applyProperties(template());
    const twice = applyProperties(once);
    expect(twice).toEqual(once);
  });

  it('keeps the metaspace cap a bigger heap does not replace', () => {
    // The plugin exists because a clean assembleRelease exhausted a 512 MiB
    // metaspace. Raising -Xmx does nothing for that, so the cap has to stay.
    expect(PROPERTIES['org.gradle.jvmargs']).toContain('-XX:MaxMetaspaceSize=');
  });
});
