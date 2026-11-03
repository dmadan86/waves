import { useEffect } from 'react';

type CaptureModule = {
  preventScreenCaptureAsync: (key?: string) => Promise<void>;
  allowScreenCaptureAsync: (key?: string) => Promise<void>;
};

/**
 * Block screenshots and recordings while the calling screen is mounted.
 *
 * Reached through a guarded `require`, not an import: expo-screen-capture is
 * native, and a JS bundle that touches it on a build made before it was added
 * (an OTA update, an old dev client) would crash at launch. Without the module
 * this does nothing.
 */
export function usePreventCapture(key: string): void {
  useEffect(() => {
    let mod: CaptureModule | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-screen-capture') as CaptureModule;
    } catch {
      return;
    }
    void mod.preventScreenCaptureAsync(key).catch(() => {});
    return () => {
      void mod.allowScreenCaptureAsync(key).catch(() => {});
    };
  }, [key]);
}
