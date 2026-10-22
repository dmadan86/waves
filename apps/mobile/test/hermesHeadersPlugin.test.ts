import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../plugins/withHermesHeaders.js') as {
  _internals: { injectHermesHeaders: (c: string) => string; MARKER: string };
};
const { injectHermesHeaders, MARKER } = plugin._internals;

const PODFILE = `target 'Waves' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
    )
  end
end
`;

describe('withHermesHeaders', () => {
  it('injects once, after react_native_post_install, inside post_install', () => {
    const out = injectHermesHeaders(PODFILE);
    expect(out.split(MARKER)).toHaveLength(2);
    expect(out.indexOf(MARKER)).toBeGreaterThan(out.indexOf('react_native_post_install'));
    expect(out.indexOf(MARKER)).toBeLessThan(out.lastIndexOf('  end\nend'));
    expect(out).toContain('hermes-engine/destroot/include');
  });

  it('is idempotent', () => {
    const once = injectHermesHeaders(PODFILE);
    expect(injectHermesHeaders(once)).toBe(once);
  });

  it('fails loudly when the Podfile has no react_native_post_install', () => {
    expect(() => injectHermesHeaders('target "x" do\nend\n')).toThrow();
  });

  it('transforms the Podfile Expo generates', () => {
    // The Podfile is generated and gitignored; skip when absent (CI).
    let src: string;
    try {
      src = readFileSync(`${__dirname}/../ios/Podfile`, 'utf8');
    } catch {
      return;
    }
    expect(injectHermesHeaders(src)).toContain(MARKER);
  });
});
