// SessionStart hook (startup, resume, compact): prints where the work stands so a new or
// compacted session continues from the plan file instead of from memory
// (.claude/rules/autonomy.md). Plain stdout is added to the session context.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const docs = join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), 'docs');
const read = (file) => {
  try {
    return readFileSync(join(docs, file), 'utf8');
  } catch {
    return '';
  }
};

/** The body of a `## title` section, up to the next `## ` heading. */
function section(text, title) {
  const start = text.indexOf(`\n## ${title}`);
  if (start < 0) return '';
  const body = text.slice(text.indexOf('\n', start + 1) + 1);
  const end = body.search(/^## /m);
  return (end < 0 ? body : body.slice(0, end)).trim();
}

const lines = [];
let plans = [];
try {
  plans = readdirSync(docs).filter((f) => f.endsWith('_PLAN.md'));
} catch {
  // No docs directory.
}
for (const file of plans) {
  const text = read(file);
  // Finished plans say so near the top (CLAUDE.md, development flow rule 2).
  if (text.split('\n').slice(0, 5).join('\n').includes('已完成')) continue;
  const status = section(text, '接續狀態');
  lines.push(`進行中的計畫檔 docs/${file}`);
  lines.push(status ? `「接續狀態」：\n${status}` : '（沒有「接續狀態」段落，先補上）');
}
if (lines.length === 0) lines.push('沒有進行中的計畫檔（docs/*_PLAN.md）。');

const nextStep = read('ROADMAP.md')
  .split('\n')
  .find((l) => l.startsWith('**下一步**'));
if (nextStep) lines.push(`ROADMAP ${nextStep}`);

const queue = section(read('REVIEW_QUEUE.md'), '待審');
const pending = (queue.match(/^### /gm) ?? []).length;
lines.push(`REVIEW_QUEUE 待審：${pending} 筆。`);
lines.push('動手前先讀 .claude/rules/autonomy.md 的「接續」。');

process.stdout.write(`${lines.join('\n')}\n`);
