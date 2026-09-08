import fs from 'node:fs';
import path from 'node:path';

import { site } from './site';

/**
 * The OpenAPI document the reference section is generated from, with its
 * `servers` entry pointed at whichever API this deployment actually documents.
 *
 * The generator reads a file off disk and has no hook to rewrite it, and the
 * prose can be templated (`markdown.preprocessor`) while the spec cannot. So
 * the spec is copied to a build-only location with the server URL substituted,
 * and the generator is pointed at the copy. Without this, a self-hosted help
 * site would document its own product against `api.wavs.co.in` — the one
 * mistake in these pages that costs somebody a whole afternoon.
 *
 * Called from docusaurus.config.ts, which runs once per build.
 */

const PREPARED_DIR = '.openapi';
const PREPARED_FILE = 'waves.yaml';

/**
 * Where the generator should read the spec from, relative to the site root.
 *
 * Paths resolve against `process.cwd()` rather than this file: every Docusaurus
 * command runs from the site directory, and `__dirname` is not defined when the
 * config is loaded as ESM.
 */
export function prepareOpenApiSpec(): string {
  const sourcePath = path.resolve(process.cwd(), site.openApiSpec);
  const preparedPath = path.resolve(process.cwd(), PREPARED_DIR, PREPARED_FILE);

  const source = fs.readFileSync(sourcePath, 'utf8');

  /*
   * Only the first `servers:` entry's `url:` is rewritten, and only when it is
   * the plain two-line form this repo's spec uses. A spec that lists several
   * servers, or templates its URL with OpenAPI server variables, is left alone:
   * guessing at somebody else's server block would be worse than documenting
   * the default.
   */
  const rewritten = source.replace(
    /^(servers:\n\s+- url: ).*$/m,
    (_match, prefix: string) => `${prefix}${site.apiUrl}`,
  );

  fs.mkdirSync(path.dirname(preparedPath), { recursive: true });
  fs.writeFileSync(preparedPath, rewritten, 'utf8');

  return `${PREPARED_DIR}/${PREPARED_FILE}`;
}
