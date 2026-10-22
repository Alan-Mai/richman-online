// Pre-push check (/pre-push step 3): every commit in a range must pass the asset rules
// and contain no TEMP-DEBUG code, not just HEAD.
// Usage: node scripts/check-commits.js <revision range>   (e.g. origin/main..HEAD)
// Exit 0 = no violations, 1 = violations, 2 = bad arguments or git failure.
import { spawnSync } from 'node:child_process';
import { assetProblems, tempDebugHits, treeEntries } from './asset-rules.js';

const range = process.argv[2];
if (!range || process.argv.length > 3) {
  console.error('Usage: node scripts/check-commits.js <revision range>');
  process.exit(2);
}

const revList = spawnSync('git', ['rev-list', '--reverse', range], { encoding: 'utf8' });
if (revList.status !== 0) {
  console.error(`git rev-list ${range} failed: ${revList.stderr.trim()}`);
  process.exit(2);
}
const commits = revList.stdout.split('\n').filter(Boolean);
if (commits.length === 0) {
  console.log(`No commits in ${range}.`);
  process.exit(0);
}

let violations = 0;
try {
  for (const commit of commits) {
    const entries = treeEntries(commit);
    const largest = entries.reduce((a, b) => (b.size > a.size ? b : a), { path: '-', size: 0 });
    const problems = [
      ...entries.flatMap((e) => assetProblems(e.path, e.size)),
      ...tempDebugHits(commit).map((hit) => `TEMP-DEBUG: ${hit.slice(commit.length + 1)}`),
    ];
    const status = problems.length === 0 ? 'ok' : `${problems.length} violation(s)`;
    console.log(
      `${commit.slice(0, 7)}  ${entries.length} files, largest ${largest.path} (${largest.size} bytes)  ${status}`,
    );
    for (const p of problems) console.log(`    - ${p}`);
    violations += problems.length;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}

console.log(`\n${commits.length} commit(s) checked, ${violations} violation(s).`);
process.exit(violations === 0 ? 0 : 1);
