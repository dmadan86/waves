/**
 * Give the Gradle daemon enough room — and enough of the machine — to build
 * this app in one clean pass.
 *
 * Expo's generated `gradle.properties` ships `-Xmx2048m -XX:MaxMetaspaceSize=512m`.
 * That 512 MiB metaspace is enough for a warm, incremental build, but a full
 * clean `assembleRelease` — every dependency's Kotlin/Java compiled at once,
 * with `react-native-maps` now in the set — exhausts it, and the daemon dies
 * mid-task with `java.lang.OutOfMemoryError: Metaspace`. The failure surfaces on
 * whichever task was running (we saw it on `processReleaseGoogleServices`), not
 * on the real cause, so it reads like an unrelated plugin error.
 *
 * `prebuild` regenerates `gradle.properties`, so raising it once by hand would
 * not survive the next prebuild — anyone building would hit the same wall. This
 * plugin re-applies the settings every prebuild.
 */

const { withGradleProperties } = require('expo/config-plugins');

/**
 * Heap and metaspace the clean build needs.
 *
 * 8 GiB of heap because the build machine has 64 and a release build is the
 * one thing it is doing; the metaspace cap and `-XX:+UseParallelGC` are the
 * originals and stay — they are what stopped the Metaspace OOM above, and a
 * bigger heap does not replace either. `file.encoding` is pinned because
 * Gradle on Windows otherwise picks up the system codepage, and the resource
 * files in this project are UTF-8.
 */
const JVM_ARGS =
  '-Xmx8192m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError ' +
  '-XX:+UseParallelGC -Dfile.encoding=UTF-8';

/**
 * The rest of the build-speed settings.
 *
 * `parallel` is already in Expo's template; it is repeated here so that all of
 * them are stated in one place and none depends on the template keeping it.
 * `configureondemand` only configures the projects a task actually needs,
 * which on a single-module app is a small win and on this one's dependency set
 * is a real one. `daemon` is Gradle's default and is pinned so a stray
 * `--no-daemon` in someone's environment does not silently cost every build
 * its JVM warm-up.
 */
const PROPERTIES = {
  'org.gradle.jvmargs': JVM_ARGS,
  'org.gradle.parallel': 'true',
  'org.gradle.configureondemand': 'true',
  'org.gradle.daemon': 'true',
};

/**
 * Put our values in and take every earlier copy of the same key out.
 *
 * Gradle reads the last value of a repeated property, so appending alone would
 * work — but a `gradle.properties` carrying `org.gradle.jvmargs` twice is a
 * file somebody will read the wrong half of. Pure, so the test can hold it to
 * both halves of that: ours present, no duplicates left behind.
 */
function applyProperties(items) {
  const kept = items.filter((item) => !(item.type === 'property' && item.key in PROPERTIES));
  return [
    ...kept,
    ...Object.entries(PROPERTIES).map(([key, value]) => ({ type: 'property', key, value })),
  ];
}

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = applyProperties(cfg.modResults);
    return cfg;
  });
};

module.exports._internals = { PROPERTIES, applyProperties };
