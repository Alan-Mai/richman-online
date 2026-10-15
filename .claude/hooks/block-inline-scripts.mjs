// PreToolUse hook: block shell commands with heredocs or inline node/tsx scripts.
// Local Git Bash mangles backslashes and quotes in these (see CLAUDE.md, style rules).
// `--inline-only` (used for PowerShell) checks only node -e / tsx -e.
const inlineOnly = process.argv.includes('--inline-only');
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    cmd = JSON.parse(input).tool_input?.command ?? '';
  } catch {
    process.exit(0);
  }
  const reasons = [];
  if (!inlineOnly && /<</.test(cmd)) reasons.push('heredoc / here-string (<<)');
  if (/\b(node|tsx)(\.exe)?\s+(-e|--eval|-p|--print)\b/.test(cmd))
    reasons.push('inline script (node -e / tsx -e)');
  if (reasons.length === 0) process.exit(0);
  process.stderr.write(
    `Blocked: ${reasons.join(', ')}.\n` +
      'Use Write/Edit for file content; for scripts, Write a file to tools/extract/scratch/ or the scratchpad and run `node <file>`; ' +
      'for commit messages, Write the message to a file and use `git commit -F <file>`.\n',
  );
  process.exit(2);
});
