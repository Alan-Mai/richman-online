// Screenshot smoke test for the client (.claude/rules/client.md): starts its own Vite dev
// server on a free port, opens it in the locally installed Edge (no browser download),
// starts an all-computer game and saves screenshots outside the repository.
// Exit 0 = no page errors, 1 = page or console errors, 2 = bad arguments or setup failure.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { USAGE, parseArgs } from './args';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLIENT_DIR = join(REPO_ROOT, 'apps', 'client');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitFor(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function startVite(port: number): ChildProcess {
  const viteManifest = createRequire(join(CLIENT_DIR, 'package.json')).resolve('vite/package.json');
  const vite = join(dirname(viteManifest), 'bin', 'vite.js');
  // Node runs Vite directly (not through pnpm), so killing this process stops the server.
  return spawn(
    process.execPath,
    [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: CLIENT_DIR,
      stdio: 'ignore',
    },
  );
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2), REPO_ROOT);
  if (!parsed.ok) {
    console.error(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { out, seconds } = parsed.args;
  mkdirSync(out, { recursive: true });

  const port = await freePort();
  const server = startVite(port);
  let browser: Browser | undefined;
  const pageErrors: string[] = [];
  try {
    if (!(await waitFor(() => isListening(port), 30_000))) {
      console.error(`Vite did not start on port ${port}`);
      return 2;
    }
    try {
      browser = await chromium.launch({ channel: 'msedge' });
    } catch (error) {
      console.error(`Could not launch the installed Edge: ${String(error)}`);
      return 2;
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      // Failed requests are reported below with their URL instead.
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
        pageErrors.push(`console.error: ${message.text()}`);
      }
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      // The page has no favicon; browsers request one anyway.
      if (response.status() >= 400 && url.pathname !== '/favicon.ico') {
        pageErrors.push(`HTTP ${response.status()}: ${url.pathname}`);
      }
    });

    await page.goto(`http://127.0.0.1:${port}/`);
    const form = page.locator('form.setup');
    await form.waitFor({ timeout: 15_000 });
    await page.screenshot({ path: join(out, '01-setup.png') });

    // Every seat a computer so the game plays itself; fixed seed for comparable shots.
    for (const select of await form.locator('select[name^="controller"]').all()) {
      await select.selectOption('computer');
    }
    await form.locator('details summary').click();
    await form.locator('input[name="seed"]').fill('1');
    await form.locator('button[type="submit"]').click();
    await page.locator('#board canvas').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: join(out, '02-start.png') });
    await page.waitForTimeout(seconds * 1_000);
    await page.screenshot({ path: join(out, '03-later.png') });
  } finally {
    await browser?.close();
    server.kill();
    if (!(await waitFor(async () => !(await isListening(port)), 10_000))) {
      console.error(`Port ${port} is still listening after stopping Vite (pid ${server.pid})`);
    }
  }

  console.log(`Screenshots: ${out} (01-setup, 02-start, 03-later)`);
  if (pageErrors.length > 0) {
    console.error(`${pageErrors.length} page error(s):`);
    for (const e of pageErrors) console.error(`  ${e}`);
    return 1;
  }
  console.log('No page errors.');
  return 0;
}

process.exitCode = await main();
