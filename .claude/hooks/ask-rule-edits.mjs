// PreToolUse hook for file edits: changes to CLAUDE.md or anything under .claude/
// (rules, skills, agents, hooks, settings) always ask the user first
// (.claude/rules/autonomy.md: rule changes need the user's confirmation).
import { relative, resolve } from 'node:path';

const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let file = '';
  try {
    const toolInput = JSON.parse(input).tool_input ?? {};
    file = toolInput.file_path ?? toolInput.notebook_path ?? '';
  } catch {
    process.exit(0);
  }
  if (!file) process.exit(0);
  const rel = relative(projectDir, resolve(projectDir, file)).replace(/\\/g, '/');
  const isRuleFile =
    rel.toLowerCase() === 'claude.md' ||
    (rel.startsWith('.claude/') && rel !== '.claude/settings.local.json');
  if (!isRuleFile) process.exit(0);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `修改規則檔 ${rel} 需要使用者確認（.claude/rules/autonomy.md）。`,
      },
    }),
  );
});
