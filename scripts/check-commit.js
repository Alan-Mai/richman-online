// Pre-commit check: the single entry point before every commit (CLAUDE.md, rule 4).
// Checks exactly what is staged, then records the staged tree id so the Claude Code
// hook (.claude/hooks/guard-git.mjs) can refuse a commit whose content was not checked.
// Exit 0 = ready to commit, 1 = a check failed.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { assetProblems, tempDebugHits, treeEntries } from './asset-rules.js';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

function fail(message) {
  console.error(`check:commit failed: ${message}`);
  process.exit(1);
}

// 1. The working tree must equal the index, so tests run against the commit's content.
const dirty = [];
const records = git('status', '--porcelain', '-z').split('\0');
for (let i = 0; i < records.length; i++) {
  const line = records[i];
  if (!line) continue;
  if (line.startsWith('??') || line[1] !== ' ') dirty.push(line);
  if (line[0] === 'R' || line[0] === 'C') i++; // next record is the rename/copy source
}
if (dirty.length > 0) {
  fail(
    'working tree differs from the index:\n' +
      dirty.map((line) => `  ${line}`).join('\n') +
      '\nStage what belongs to this commit, then `git stash push -k -u` the rest (see .claude/rules/commit-workflow.md).',
  );
}

const staged = git('diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR')
  .split('\0')
  .filter(Boolean);
const deleted = git('diff', '--cached', '--name-only', '-z', '--diff-filter=D')
  .split('\0')
  .filter(Boolean);
if (staged.length === 0 && deleted.length === 0) fail('nothing is staged');

// 2. Asset rules on the whole staged tree; 3. no TEMP-DEBUG in staged code.
const tree = git('write-tree').trim();
const problems = treeEntries(tree).flatMap((e) => assetProblems(e.path, e.size));
if (problems.length > 0) fail(`asset guard:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
const hits = tempDebugHits(null);
if (hits.length > 0) fail(`TEMP-DEBUG left in code:\n${hits.map((h) => `  ${h}`).join('\n')}`);

// 4. Formatting of staged files (`pnpm format` should already have been run and added).
const unformatted = [];
for (const file of staged) {
  const info = await prettier.getFileInfo(file, { ignorePath: ['.gitignore', '.prettierignore'] });
  if (info.ignored || info.inferredParser === null) continue;
  const options = { ...(await prettier.resolveConfig(file)), filepath: file };
  if (!(await prettier.check(readFileSync(file, 'utf8'), options))) unformatted.push(file);
}
if (unformatted.length > 0) {
  fail(
    `not formatted (run \`pnpm format\` and stage):\n${unformatted.map((f) => `  ${f}`).join('\n')}`,
  );
}

// 5. Lint, typecheck and tests, unless only Markdown changes (Prettier skips *.md too).
const docsOnly = [...staged, ...deleted].every((file) => file.endsWith('.md'));
if (docsOnly) {
  console.log('Only Markdown staged: skipping lint, typecheck and tests.');
} else {
  for (const script of ['lint', 'typecheck', 'test']) {
    console.log(`\n> pnpm ${script}`);
    const result = spawnSync('pnpm', [script], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) fail(`pnpm ${script} exited with ${result.status ?? result.signal}`);
  }
}

// 6. Remember which content passed; any later staging change invalidates it.
writeFileSync(git('rev-parse', '--git-path', 'richman-check-ok').trim(), `${tree}\n`);
console.log(`\ncheck:commit passed (tree ${tree.slice(0, 12)}).`);
