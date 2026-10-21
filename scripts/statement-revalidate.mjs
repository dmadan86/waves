#!/usr/bin/env node
/**
 * Monthly revalidation of the bank statement importer.
 *
 * Banks change their exports without telling anyone. The importer is tested
 * against vendored copies of real-format samples (packages/core/test/fixtures/
 * statement/real, listed in its NOTICE.md). This script re-fetches each of
 * those files from its repository's default branch, reports how the upstream
 * copy now differs from ours (header, column count and order, date format),
 * then runs the core statement tests.
 *
 *   node scripts/statement-revalidate.mjs            # report + tests
 *   node scripts/statement-revalidate.mjs --no-tests # report only
 *   node scripts/statement-revalidate.mjs --out report.md
 *
 * Exit status is non-zero only when the tests fail. Drift is reported, never
 * fatal: an upstream change is a prompt to look, not proof that we broke.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'packages/core/test/fixtures/statement/real');
const args = new Set(process.argv.slice(2));
const outPath = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : null;

/** The sources table of NOTICE.md: `| vendored | repo url | path | commit | licence |`. */
function readSources() {
  const notice = readFileSync(join(fixtures, 'NOTICE.md'), 'utf8');
  const rows = [];
  for (const line of notice.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6 || !cells[2].startsWith('https://github.com/')) continue;
    rows.push({
      file: cells[1],
      repo: cells[2],
      path: cells[3],
      commit: cells[4],
      licence: cells[5],
    });
  }
  return rows;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'waves-statement-revalidate' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

const normalise = (text) => text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
const lines = (text) => normalise(text).split('\n');

/** The first line that reads as a column header: several delimited words, none a number. */
function headerOf(text) {
  for (const line of lines(text)) {
    const delimiter = line.includes('\t') ? '\t' : ',';
    const cells = line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length >= 3 && cells.every((c) => !/^-?[\d.,]+$/.test(c)) && /[a-z]/i.test(line)) {
      return { line, cells, delimiter };
    }
  }
  return null;
}

/** The shape of the first date-looking cell: `dd/mm/yyyy`, `d Mon yyyy`, `yyyymmdd`… */
function dateShape(text) {
  const match =
    /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[ -][A-Za-z]{3}[ -]\d{2,4}|\d{8})\b/.exec(
      text,
    );
  if (!match) return 'none';
  return match[1]
    .replace(/\d{4}/g, 'yyyy')
    .replace(/\d{2}/g, 'nn')
    .replace(/\d/g, 'n')
    .replace(/[A-Za-z]{3}/, 'Mon');
}

function compare(ours, theirs) {
  const notes = [];
  if (normalise(ours) === normalise(theirs)) return notes;
  const a = headerOf(ours);
  const b = headerOf(theirs);
  if (a && b && a.line !== b.line) {
    if (a.cells.length !== b.cells.length)
      notes.push(`column count ${a.cells.length} -> ${b.cells.length}`);
    else if (a.cells.join('|').toLowerCase() === b.cells.join('|').toLowerCase())
      notes.push('header case or spacing changed');
    else if ([...a.cells].sort().join('|') === [...b.cells].sort().join('|'))
      notes.push('column order changed');
    else notes.push(`header changed: "${a.line}" -> "${b.line}"`);
  } else if ((a === null) !== (b === null)) notes.push('header row appeared or disappeared');
  const da = dateShape(ours);
  const db = dateShape(theirs);
  if (da !== db) notes.push(`date format ${da} -> ${db}`);
  const la = lines(ours).length;
  const lb = lines(theirs).length;
  if (la !== lb) notes.push(`${la} -> ${lb} lines`);
  if (notes.length === 0) notes.push('content changed (same header, columns and date format)');
  return notes;
}

async function main() {
  const sources = readSources();
  const report = [];
  const drift = [];
  let missing = 0;
  for (const source of sources) {
    const ours = readFileSync(join(fixtures, source.file), 'utf8');
    const url = `${source.repo.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/HEAD/${source.path}`;
    let theirs;
    try {
      theirs = await fetchText(url);
    } catch (error) {
      missing += 1;
      drift.push(`- ${source.file}: upstream fetch failed (${error.message}) — ${url}`);
      continue;
    }
    const notes = compare(ours, theirs);
    if (notes.length > 0) drift.push(`- ${source.file}: ${notes.join('; ')} — ${source.repo}`);
  }

  report.push(`## Upstream drift (${sources.length} vendored files checked)`);
  report.push('');
  report.push(
    drift.length === 0
      ? 'No vendored fixture differs from its upstream default branch.'
      : drift.join('\n'),
  );
  if (missing > 0)
    report.push(
      '',
      `${missing} file(s) could not be fetched (moved, renamed or the repository is gone).`,
    );

  let failed = false;
  if (!args.has('--no-tests')) {
    const run = spawnSync('npx', ['vitest', 'run', 'test/statement'], {
      cwd: join(root, 'packages/core'),
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const summary = output
      .split('\n')
      .filter((line) => /Test Files|Tests |FAIL|✗|×/.test(line))
      .slice(0, 40)
      .join('\n');
    failed = run.status !== 0;
    report.push(
      '',
      `## Core statement tests: ${failed ? 'FAILED' : 'passed'}`,
      '',
      '```',
      summary.trim() || output.slice(-2000),
      '```',
    );
  }

  const text = report.join('\n');
  console.log(text);
  if (outPath) writeFileSync(outPath, `${text}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
