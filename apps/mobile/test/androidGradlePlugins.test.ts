/**
 * Prebuild plugins that quote Expo's generated Android files keep working on the
 * assignment-form template (`signingConfig = signingConfigs.debug`) that newer
 * Expo templates write, and the theme plugin removes the two Android 15
 * deprecated bar-colour attributes.
 */

import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-require-imports */
const { patchBuildGradle } = require('../plugins/withReleaseSigning.js') as {
  patchBuildGradle: (contents: string) => string;
};
const { stripDeprecatedBarColors } = require('../plugins/withEdgeToEdgeTheme.js') as {
  stripDeprecatedBarColors: (styles: {
    resources: { style: { $: { name: string }; item: { $: { name: string } }[] }[] };
  }) => { resources: { style: { item: { $: { name: string } }[] }[] } };
};
/* eslint-enable @typescript-eslint/no-require-imports */

const ASSIGN_TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig = signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig = signingConfigs.debug
        }
    }
}
`;

describe('withReleaseSigning on the assignment-form template', () => {
  it('signs release with the upload key when present', () => {
    const out = patchBuildGradle(ASSIGN_TEMPLATE);
    expect(out).toContain('signingConfig wavesHasUploadKey ? signingConfigs.release');
  });
});

describe('withEdgeToEdgeTheme', () => {
  it('removes statusBarColor and navigationBarColor from AppTheme only', () => {
    const names = (n: string) => ({ $: { name: n } });
    const out = stripDeprecatedBarColors({
      resources: {
        style: [
          {
            $: { name: 'AppTheme' },
            item: [
              names('colorPrimary'),
              names('android:statusBarColor'),
              names('android:navigationBarColor'),
            ],
          },
        ],
      },
    });
    expect(out.resources.style[0].item.map((i) => i.$.name)).toEqual(['colorPrimary']);
  });
});
