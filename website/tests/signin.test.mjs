// Self-check: node --experimental-strip-types website/tests/signin.test.mjs
import assert from 'node:assert/strict';

import { appHost, signInHref } from '../src/lib/signin.ts';

assert.equal(signInHref('https://app.wavs.co.in', 'google'), 'https://app.wavs.co.in/?signin=google');
assert.equal(signInHref('https://app.wavs.co.in/x', 'apple'), 'https://app.wavs.co.in/?signin=apple');
assert.equal(appHost('https://app.wavs.co.in'), 'app.wavs.co.in');
assert.equal(appHost('http://localhost:7601'), 'localhost:7601');
console.log('signin ok');
