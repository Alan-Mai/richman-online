// Terminal simulator: random AIs play many games and every step is checked (docs/ARCHITECTURE.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { USAGE, parseCommand } from './args';
import { runCommand } from './simulate';

/** tools/sim/out/, gitignored; shown relative to tools/sim, where `pnpm -F sim` runs. */
const OUT_DIR = new URL('../out/', import.meta.url);

const parsed = parseCommand(process.argv.slice(2));
if (!parsed.ok) {
  for (const error of parsed.errors) console.error(error);
  console.error(USAGE);
  process.exitCode = 2;
} else {
  process.exitCode = runCommand(parsed.command, {
    print: (text) => console.log(text),
    writeLog: (name, text) => {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(fileURLToPath(new URL(name, OUT_DIR)), text);
      return `out/${name}`;
    },
    readFile: (path) => readFileSync(path, 'utf8'),
    now: () => performance.now(),
  });
}
