// Shared rules that keep original game assets and debug code out of version control
// (see CLAUDE.md). Used by check-assets.js (working tree), check-commit.js (index)
// and check-commits.js (each commit about to be pushed).
import { execFileSync, spawnSync } from 'node:child_process';

export const MAX_BYTES = 1024 * 1024;
const BANNED_EXT = /\.(mkf|exe|dll|avi|mid|wav|iso)$/i;
const FIXTURES = /^tools\/(?:[^/]+\/)*fixtures\//;
const ENV_FILE = /(?:^|\/)\.env(?:\..+)?$/;
const ENV_EXAMPLE = /(?:^|\/)\.env\.example$/;

/** Problems for one tracked file, given its repo-relative path and size in bytes. */
export function assetProblems(file, size) {
  if (file.startsWith('local-assets/')) return [`${file}: local-assets/ must never be committed`];
  const problems = [];
  if (file.startsWith('tools/sim/out/')) {
    problems.push(`${file}: simulator output may contain imported original data`);
  }
  if (file === 'tables.json' || file.endsWith('/tables.json')) {
    problems.push(`${file}: tables.json is the extracted original data table name`);
  }
  if (ENV_FILE.test(file) && !ENV_EXAMPLE.test(file)) {
    problems.push(`${file}: environment files must not be committed`);
  }
  if (BANNED_EXT.test(file) && !FIXTURES.test(file)) {
    problems.push(`${file}: banned extension (original game file type)`);
  }
  if (size > MAX_BYTES) problems.push(`${file}: ${size} bytes exceeds ${MAX_BYTES}`);
  return problems;
}

/** Blob entries `{ path, size }` of a tree-ish (commit, tree id). */
export function treeEntries(treeish) {
  const out = execFileSync('git', ['ls-tree', '-r', '-l', '-z', treeish], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const entries = [];
  for (const record of out.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const [, type, , size] = record.slice(0, tab).split(/ +/);
    if (type !== 'blob') continue;
    entries.push({ path: record.slice(tab + 1), size: Number(size) });
  }
  return entries;
}

// Docs, Claude Code rules and these checkers may mention the marker; other code may not.
const TEMP_DEBUG_PATHSPEC = [
  '--',
  '.',
  ':!*.md',
  ':!.claude/',
  ':!scripts/asset-rules.js',
  ':!scripts/check-commit.js',
  ':!scripts/check-commits.js',
];

/**
 * `TEMP-DEBUG` lines in a commit, or in the index when `treeish` is `null`.
 * Throws when git grep itself fails (exit code other than 0 or 1).
 */
export function tempDebugHits(treeish) {
  const where = treeish === null ? ['--cached', 'TEMP-DEBUG'] : ['TEMP-DEBUG', treeish];
  const result = spawnSync('git', ['grep', '-n', ...where, ...TEMP_DEBUG_PATHSPEC], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status === 1) return [];
  if (result.status === 0) return result.stdout.split('\n').filter(Boolean);
  throw new Error(`git grep failed (exit ${result.status}): ${result.stderr.trim()}`);
}
