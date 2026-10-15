import { readFileSync } from 'node:fs';

import { decodeBytes } from '../../src/import/table.js';

/** A file from `test/fixtures/import/`, as the bytes a phone would hand us. */
export const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/import/${name}`, import.meta.url)));

/** The same file, decoded the way the app decodes it. */
export const fixtureText = (name: string): string => decodeBytes(fixtureBytes(name)).text;
