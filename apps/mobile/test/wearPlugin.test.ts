import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _internals } = require('../plugins/withWavesWear.js');
const {
  WEAR_PACKAGE,
  APPLICATION_ID,
  MARKER,
  settingsWithInclude,
  buildscriptWithCompose,
  writeWearModule,
} = _internals as {
  WEAR_PACKAGE: string;
  APPLICATION_ID: string;
  MARKER: string;
  settingsWithInclude: (contents: string) => string;
  buildscriptWithCompose: (contents: string) => string;
  writeWearModule: (projectRoot: string) => void;
};

describe('withWavesWear — settings.gradle include', () => {
  it("adds a single include ':wear' and is idempotent", () => {
    const base = "rootProject.name = 'app'\n";
    const once = settingsWithInclude(base);
    expect(once).toContain("include ':wear'");
    expect(once).toContain(MARKER);
    // A second prebuild must not append it again.
    expect(settingsWithInclude(once)).toBe(once);
  });
});

describe('withWavesWear — Compose compiler classpath', () => {
  const root = `buildscript {
    dependencies {
        classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')
    }
}`;

  it('adds the compose-compiler plugin next to kotlin-gradle-plugin, once', () => {
    const once = buildscriptWithCompose(root);
    expect(once).toContain('org.jetbrains.kotlin:compose-compiler-gradle-plugin');
    expect(once).toContain("classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')");
    // Idempotent across prebuilds.
    expect(buildscriptWithCompose(once)).toBe(once);
    // Exactly one insertion.
    expect(once.match(/compose-compiler-gradle-plugin/g)).toHaveLength(1);
  });
});

describe('withWavesWear — emitted :wear module', () => {
  const root = mkdtempSync(join(tmpdir(), 'waves-wear-'));
  writeWearModule(root);
  const wear = join(root, 'android', 'wear');
  const pkgDir = join(wear, 'src', 'main', 'java', ...WEAR_PACKAGE.split('.'));

  it('writes the module build.gradle, manifest and Kotlin sources', () => {
    expect(existsSync(join(wear, 'build.gradle'))).toBe(true);
    expect(existsSync(join(wear, 'src', 'main', 'AndroidManifest.xml'))).toBe(true);
    for (const file of ['MainActivity.kt', 'WearRelay.kt', 'PhoneListenerService.kt']) {
      expect(existsSync(join(pkgDir, file))).toBe(true);
    }
  });

  it('the build.gradle is a standalone Wear application with the right id', () => {
    const gradle = readFileSync(join(wear, 'build.gradle'), 'utf8');
    expect(gradle).toContain('com.android.application');
    expect(gradle).toContain(`applicationId "${APPLICATION_ID}"`);
    expect(gradle).toContain('play-services-wearable');
    expect(gradle).toContain('androidx.wear.compose');
  });

  it('the manifest declares a standalone watch app and the /waves listener', () => {
    const xml = readFileSync(join(wear, 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    expect(xml).toContain('android.hardware.type.watch');
    expect(xml).toContain('com.google.android.wearable.standalone');
    expect(xml).toContain('com.google.android.gms.wearable.MESSAGE_RECEIVED');
    expect(xml).toContain('pathPrefix="/waves"');
  });

  it('the relay client and phone listener agree on the /waves path', () => {
    const relay = readFileSync(join(pkgDir, 'WearRelay.kt'), 'utf8');
    const listener = readFileSync(join(pkgDir, 'PhoneListenerService.kt'), 'utf8');
    expect(relay).toContain('const val PATH = "/waves"');
    expect(relay).toContain(`package ${WEAR_PACKAGE}`);
    expect(listener).toContain('WearRelay.onMessage');
    // The intents the phone bridge understands; voice is a clip, never text.
    for (const t of ['quickAdd', 'voiceClip', 'requestRecent']) {
      expect(relay).toContain(`"${t}"`);
    }
    // Quick-add sends what was dialled; the phone scales it for the currency.
    expect(relay).toContain('.put("amount", amount.toString())');
    expect(relay).not.toContain('amountMinor');
    // Intents are persisted before any send, so no phone means queued, not lost.
    expect(relay).toContain('fun enqueue(');
  });
});

describe('withWavesWear — offline-first adds', () => {
  const root = mkdtempSync(join(tmpdir(), 'waves-wear-offline-'));
  writeWearModule(root);
  const wear = join(root, 'android', 'wear');
  const pkgDir = join(wear, 'src', 'main', 'java', ...WEAR_PACKAGE.split('.'));
  const relay = readFileSync(join(pkgDir, 'WearRelay.kt'), 'utf8');
  const main = readFileSync(join(pkgDir, 'MainActivity.kt'), 'utf8');
  const manifest = readFileSync(join(wear, 'src', 'main', 'AndroidManifest.xml'), 'utf8');

  it('stores every add on the watch first, with a client id and the time it was made', () => {
    expect(relay).toContain('private fun enqueue(');
    expect(relay).toContain('UUID.randomUUID()');
    expect(relay).toContain('.put("madeAt", now)');
    expect(relay).toContain('.put("tzOffsetMin"');
    expect(relay).toContain('getSharedPreferences("waves_relay"');
    // Pending until the phone acks the id; shown as saved on the watch.
    expect(relay).toContain('"ack" ->');
    expect(relay).toContain('Saved on watch · will sync');
    expect(relay).toContain('Voice note · will sync');
    expect(relay).toContain('Voice note · sent to phone');
    expect(main).toContain('WearRelay.pendingItems');
  });

  it('captures the watch location only when the phone setting is on and permission is held', () => {
    expect(relay).toContain('if (!_locationEnabled.value) return null');
    expect(relay).toContain('ACCESS_COARSE_LOCATION');
    expect(relay).toContain('getCurrentLocation(');
    expect(relay).toContain('LOCATION_TIMEOUT_S = 3L');
    expect(relay).toContain('obj.optBoolean("locationEnabled", false)');
    // Permission is requested only once the setting is on.
    expect(main).toMatch(/if \(locationEnabled &&/);
    expect(manifest).toContain('android.permission.ACCESS_COARSE_LOCATION');
  });

  it('records voice as a clip and never runs speech recognition on the watch', () => {
    expect(main).toContain('MediaRecorder');
    expect(main).toContain('AudioEncoder.AAC');
    expect(main).toContain('OutputFormat.MPEG_4');
    expect(main).not.toContain('RecognizerIntent');
    expect(relay).not.toContain('"voiceAdd"');
    expect(relay).toContain('MAX_CLIP_MS = 30_000');
    expect(relay).toContain('sendFile(');
    expect(relay).toContain('CLIP_PATH');
    expect(manifest).toContain('android.permission.RECORD_AUDIO');
  });

  it('the phone module receives the clip channel', () => {
    const phone = join(__dirname, '..', 'modules', 'waves-watch', 'android', 'src', 'main');
    const svc = readFileSync(
      join(phone, 'java', 'expo', 'modules', 'waveswatch', 'WavesWatchListenerService.kt'),
      'utf8',
    );
    expect(svc).toContain('onChannelOpened');
    expect(svc).toContain('receiveFile(');
    expect(readFileSync(join(phone, 'AndroidManifest.xml'), 'utf8')).toContain('CHANNEL_EVENT');
  });
});
