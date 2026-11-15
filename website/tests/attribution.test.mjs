// Self-check (the website has no test runner):
//   node --experimental-strip-types website/tests/attribution.test.mjs
import assert from 'node:assert/strict';

import { MAX_VALUE_LENGTH, parseAttribution, withAttribution } from '../src/lib/attribution.ts';

const a = parseAttribution('?utm_source=test&utm_campaign=x&foo=bar&utm_term=' + 'z'.repeat(500));
assert.deepEqual(Object.keys(a), ['utm_source', 'utm_campaign', 'utm_term']);
assert.equal(a.utm_term.length, MAX_VALUE_LENGTH);

assert.equal(
  withAttribution('https://app.wavs.co.in/x?ref=1&utm_source=keep', a, 'web'),
  'https://app.wavs.co.in/x?ref=1&utm_source=keep&utm_campaign=x&utm_term=' + 'z'.repeat(100),
);
const play = new URL(
  withAttribution(
    'https://play.google.com/store/apps/details?id=app.waves.mobile',
    { utm_source: 'a b', utm_campaign: 'x' },
    'store',
  ),
);
assert.equal(play.searchParams.get('id'), 'app.waves.mobile');
assert.equal(play.searchParams.get('referrer'), 'utm_source=a+b&utm_campaign=x');
assert.equal(withAttribution('https://apps.apple.com/app/x', a, 'store'), 'https://apps.apple.com/app/x');
assert.equal(withAttribution('mailto:a@b.c', a, 'web'), 'mailto:a@b.c');
console.log('attribution ok');
