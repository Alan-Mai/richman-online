// Guard against original game assets entering version control (see CLAUDE.md).
// Fails if a tracked file has a banned extension (outside tools/**/fixtures/),
// lives under local-assets/, or exceeds MAX_BYTES. See docs/DECISIONS.md.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const MAX_BYTES = 1024 * 1024;
const BANNED_EXT = /\.(mkf|exe|dll|avi|mid|wav|iso)$/i;
const FIXTURES = /^tools\/(?:[^/]+\/)*fixtures\//;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const problems = [];
for (const file of files) {
  if (file.startsWith('local-assets/')) {
    problems.push(`${file}: local-assets/ must never be committed`);
    continue;
  }
  if (BANNED_EXT.test(file) && !FIXTURES.test(file)) {
    problems.push(`${file}: banned extension (original game file type)`);
  }
  const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  if (size > MAX_BYTES) {
    problems.push(`${file}: ${size} bytes exceeds ${MAX_BYTES}`);
  }
}

if (problems.length > 0) {
  console.error('Asset guard failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log(`Asset guard passed (${files.length} tracked files).`);
}
