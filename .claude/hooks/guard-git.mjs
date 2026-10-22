// PreToolUse hook for Bash and PowerShell git commands in this repository:
// - `git commit` is blocked unless `pnpm check:commit` passed for exactly the staged content
//   (it records the staged tree id in .git/richman-check-ok; see scripts/check-commit.js).
// - `git commit -a` is blocked (it would commit content the check did not see).
// - `git add -f` is blocked (CLAUDE.md, rule 11: test guards in a throwaway repo instead).
// - `git push` asks the user (pushing only happens through /pre-push, CLAUDE.md rule 9).
// Each git invocation's directory is followed through `cd` and `git -C`; only invocations
// whose directory belongs to another repository (e.g. a throwaway test repo) are left alone.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Resolves a cd / -C target, accepting Git Bash (/c/...) and Windows paths. */
function resolveDir(from, target) {
  const p = target.replace(/^~(?=$|[\\/])/, homedir()).replace(/^\/([a-zA-Z])(?=$|\/)/, '$1:');
  return resolve(from, p);
}

/** The repository top level containing `dir`, normalized, or null outside any repository. */
function repoOf(dir) {
  try {
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return resolve(top).replace(/\\/g, '/').toLowerCase();
  } catch {
    return null;
  }
}

/** Splits a shell segment into words, honoring single and double quotes. */
function words(text) {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/**
 * Each git invocation with the directory it runs in, following `cd`-style commands
 * from left to right, e.g. `{ dir, sub: 'commit', args: ['-F', 'msg'] }`.
 */
function gitInvocations(cmd, startDir) {
  const calls = [];
  let cwd = startDir;
  for (const segment of cmd.split(/&&|\|\||[;|\n]/)) {
    const w = words(segment.trim().replace(/^\(\s*/, ''));
    const head = w[0]?.toLowerCase();
    if (['cd', 'pushd', 'set-location', 'push-location', 'sl'].includes(head ?? '')) {
      const target = w.slice(1).find((x) => !/^-(LiteralPath|Path)$/i.test(x));
      if (target) cwd = resolveDir(cwd, target);
      continue;
    }
    const at = w.findIndex((x) => /^git(\.exe)?$/i.test(x));
    if (at < 0) continue;
    let dir = cwd;
    let i = at + 1;
    // Global options before the subcommand.
    while (i < w.length && w[i]?.startsWith('-')) {
      const opt = w[i];
      if (opt === '-C') dir = resolveDir(dir, w[++i] ?? '.');
      else if (opt === '-c') i++;
      i++;
    }
    const sub = w[i];
    if (sub) calls.push({ dir, sub, args: w.slice(i + 1) });
  }
  return calls;
}

function block(reason) {
  process.stderr.write(`Blocked: ${reason}\n`);
  process.exit(2);
}

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function git(...args) {
  return execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' }).trim();
}

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let cmd = '';
  let startDir = projectDir;
  try {
    const data = JSON.parse(input);
    cmd = data.tool_input?.command ?? '';
    // The shell's working directory persists between calls, so start from the reported one.
    if (typeof data.cwd === 'string' && data.cwd) startDir = data.cwd;
  } catch {
    process.exit(0);
  }
  const project = repoOf(projectDir);
  const calls = gitInvocations(cmd, startDir).filter(
    (c) => project !== null && repoOf(c.dir) === project,
  );

  for (const { sub, args } of calls) {
    if (sub === 'add' && args.some((a) => a === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a))) {
      block(
        '`git add -f` in this repository (CLAUDE.md rule 11). Test guards in a throwaway repo.',
      );
    }
    if (sub === 'commit') {
      if (args.some((a) => a === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a))) {
        block(
          '`git commit -a` commits content that `pnpm check:commit` did not check. Stage explicitly.',
        );
      }
      let stamp = '';
      try {
        const stampPath = resolve(projectDir, git('rev-parse', '--git-path', 'richman-check-ok'));
        stamp = readFileSync(stampPath, 'utf8').trim();
      } catch {
        // No stamp yet.
      }
      let tree = '';
      try {
        tree = git('write-tree');
      } catch {
        process.exit(0); // Unmerged index etc.: let git report it.
      }
      if (stamp !== tree) {
        block(
          'the staged content has not passed `pnpm check:commit` ' +
            '(run `pnpm format`, stage, then `pnpm check:commit`; any later staging change needs a re-run).',
        );
      }
    }
  }
  if (calls.some((c) => c.sub === 'push')) {
    ask('git push：推送只在使用者輸入 /pre-push 且全部檢查通過後進行（CLAUDE.md 第 9 條）。');
  }
  process.exit(0);
});
