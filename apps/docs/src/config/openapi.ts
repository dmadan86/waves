import fs from 'node:fs';
import path from 'node:path';

import { site } from './site';

/**
 * The OpenAPI document the reference section is generated from, with its first
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

/** Thrown when the document is not shaped the way the rewrite below can read. */
class SpecServerError extends Error {
  constructor(specPath: string, problem: string) {
    super(
      `Could not point ${specPath} at ${site.apiUrl}: ${problem}.\n` +
        'The reference would have been generated against whatever host the ' +
        'document names, which for a self-hosted Waves is the wrong one.\n' +
        'Either give the document a top-level `servers:` list whose first ' +
        'entry has a literal `url:` line, or teach ' +
        'apps/docs/src/config/openapi.ts to read the shape it does have.',
    );
    this.name = 'SpecServerError';
  }
}

/**
 * Replace the `url:` of the first entry in a top-level `servers:` list.
 *
 * A line rewrite rather than a YAML round-trip, because parsing and
 * re-emitting the document would reformat and reorder somebody else's file for
 * the sake of one string. It is therefore narrow — but it is loud about being
 * narrow: anything it cannot read throws instead of passing the original
 * through, because a reference that quietly documents the wrong host is the
 * failure this whole function exists to prevent.
 */
function withServerUrl(source: string, specPath: string, url: string): string {
  const lines = source.split('\n');

  const start = lines.findIndex((line) => /^servers:\s*(#.*)?$/.test(line));
  if (start === -1) {
    throw new SpecServerError(specPath, 'it has no top-level `servers:` block');
  }

  // The block runs until the next top-level key. Anything indented, blank or a
  // comment still belongs to it.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() !== '' && !/^[\s#]/.test(line)) {
      end = i;
      break;
    }
  }

  /*
   * The first `url:` inside the block, wherever it sits in the first entry.
   * `- description:` may come first, and often does; what must not happen is
   * reaching past the first entry into the second server's url, so the search
   * stops at the second `- ` item.
   */
  let urlLine = -1;
  let items = 0;
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i] as string;
    if (/^\s*-\s/.test(line)) {
      items += 1;
      if (items > 1) break;
    }
    if (/^(\s*(?:-\s+)?)url:\s*\S/.test(line)) {
      urlLine = i;
      break;
    }
  }

  if (urlLine === -1) {
    throw new SpecServerError(
      specPath,
      items === 0
        ? 'its `servers:` block has no entries'
        : 'the first server has no plain `url:` line (an inline `- {url: …}` or a ' +
            '`{variable}` template is not something this rewrite can read)',
    );
  }

  const prefix = (lines[urlLine] as string).match(/^(\s*(?:-\s+)?)url:\s*/)?.[0] ?? '';
  lines[urlLine] = `${prefix}${url}`;

  return lines.join('\n');
}

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
  const rewritten = withServerUrl(source, site.openApiSpec, site.apiUrl);

  fs.mkdirSync(path.dirname(preparedPath), { recursive: true });
  fs.writeFileSync(preparedPath, rewritten, 'utf8');

  return `${PREPARED_DIR}/${PREPARED_FILE}`;
}
