// Guard against original game assets entering version control (see CLAUDE.md).
// Checks every tracked file in the working tree against the rules in asset-rules.js.
// See docs/DECISIONS.md.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { assetProblems } from './asset-rules.js';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const problems = files.flatMap((file) =>
  assetProblems(file, statSync(file, { throwIfNoEntry: false })?.size ?? 0),
);

if (problems.length > 0) {
  console.error('Asset guard failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log(`Asset guard passed (${files.length} tracked files).`);
}
