// Screen smoke test: serves the app on the demo fixtures, opens every screen
// in screens.mjs as each persona that can open it, and fails on
//  - an uncaught exception or a console error;
//  - a request no fixture answers, any 4xx/5xx, a failed request, or a
//    request to anywhere but the demo server;
//  - the error screen, an error box, the sign-in screen, or being sent to
//    another screen.
//
//   node tools/demo/smoke.mjs [--only <text>] [--as <persona>] [--port 5191] [--out <dir>] [--jobs 4]
// Screenshots of failing screens go to --out (default: <tmp>/eddy-smoke).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { startDemoServer } from './server.mjs';
import { launchBrowser } from './cdp.mjs';
import { SCREENS } from './screens.mjs';
import { PERSONAS } from './personas.mjs';

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    as: { type: 'string' },
    port: { type: 'string', default: '5191' },
    out: { type: 'string', default: path.join(os.tmpdir(), 'eddy-smoke') },
    jobs: { type: 'string', default: '4' },
  },
});

const port = Number(args.port);
const outDir = path.resolve(args.out); // before the server changes the cwd
const base = `http://127.0.0.1:${port}`;
const started = Date.now();

const jobs = SCREENS.flatMap((s) => s.who.map((as) => ({ ...s, as })))
  .filter((j) => !args.only || j.path.includes(args.only) || j.screen.toLowerCase().includes(args.only.toLowerCase()))
  .filter((j) => !args.as || j.as === args.as);
for (const j of jobs) if (!PERSONAS[j.as]) throw new Error(`screens.mjs: unknown persona ${j.as}`);
if (!jobs.length) throw new Error("No screen matches --only/--as.");

const serverLog = [];
const server = await startDemoServer({ port, quiet: true, log: (line) => serverLog.push(line) });
const browser = await launchBrowser({ port: port + 1000 });
fs.rmSync(outDir, { recursive: true, force: true });

const ERROR_WORDS = /could ?n[o']t|failed|went wrong|try again|not load/i;

async function check(page, job) {
  const problems = [];
  const listener = (msg) => {
    const p = msg.params;
    switch (msg.method) {
      case 'Runtime.exceptionThrown':
        problems.push(`exception: ${p.exceptionDetails.exception?.description?.split('\n')[0] ?? p.exceptionDetails.text}`);
        break;
      case 'Runtime.consoleAPICalled':
        if (p.type === 'error' || p.type === 'assert') {
          problems.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
        }
        break;
      case 'Network.requestWillBeSent': {
        const u = new URL(p.request.url);
        if (/^https?:$/.test(u.protocol) && u.host !== `127.0.0.1:${port}`) problems.push(`request outside the demo: ${p.request.method} ${u.origin}${u.pathname}`);
        if (u.pathname === '/demo-api/api/client-error') problems.push('the app reported a crash (POST /api/client-error)');
        break;
      }
      case 'Network.responseReceived': {
        const r = p.response;
        const headers = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v]));
        const where = new URL(r.url).pathname + new URL(r.url).search;
        if (headers['x-demo-missing']) problems.push(`no fixture: ${where}${r.status === 500 ? ' (fixture threw)' : ''}`);
        else if (r.status >= 400) problems.push(`HTTP ${r.status}: ${where}`);
        break;
      }
      case 'Network.loadingFailed':
        if (!p.canceled) problems.push(`request failed: ${p.errorText} (${p.type})`);
        break;
    }
  };
  page.on(listener);
  const url = `${base}${job.path}${job.path.includes('?') ? '&' : '?'}as=${job.as}`;
  await page.send('Page.navigate', { url });
  const settled = await page.settle({ quietMs: 500, timeoutMs: 60_000 });
  if (!settled) problems.push('still loading after 60 s');
  // A busy machine can pause between the code arriving and the screen drawing.
  for (let i = 0; i < 20 && !(await page.eval(`return !!document.querySelector('h1')`).catch(() => false)); i++) await page.settle({ timeoutMs: 1000 });
  const dom = await page.eval(`
    const text = document.body.innerText;
    return {
      path: location.pathname,
      title: document.querySelector('h1')?.innerText.trim() ?? '',
      routeError: /Something went wrong/.test(text) && /Reload/.test(text),
      signIn: !!document.querySelector('input[type=email]') && !document.querySelector('h1'),
      alerts: [...document.querySelectorAll('[role=alert]')].map((e) => e.innerText.trim()).filter((t) => ${ERROR_WORDS}.test(t)),
    };`).catch((e) => ({ evalError: String(e) }));
  if (dom.evalError) problems.push(`page script failed: ${dom.evalError}`);
  else {
    if (dom.path !== job.path.split('?')[0]) problems.push(`ended on ${dom.path}`);
    if (dom.routeError) problems.push('the error screen ("Something went wrong")');
    if (dom.signIn) problems.push('the sign-in screen');
    for (const a of dom.alerts) problems.push(`error box: ${a.replace(/\s+/g, ' ').slice(0, 120)}`);
    if (!dom.title) problems.push('no screen title (h1)');
  }
  page.off(listener);
  return { problems: [...new Set(problems)], title: dom.title ?? '' };
}

const results = [];
const queue = [...jobs];
async function worker(limit = Infinity) {
  const page = await browser.newPage();
  for (let n = 0; queue.length && n < limit; n++) {
    const job = queue.shift();
    const t0 = Date.now();
    const { problems, title } = await check(page, job);
    results.push({ ...job, problems, title, ms: Date.now() - t0 });
    const mark = problems.length ? 'FAIL' : 'ok  ';
    console.log(`${mark} ${job.as.padEnd(19)} ${job.path.padEnd(28)} ${String(Date.now() - t0).padStart(5)} ms  ${title}`);
    for (const p of problems) console.log(`       - ${p}`);
    if (problems.length) {
      await page.screenshot(path.join(outDir, `${job.as}${job.path.replace(/[/:]/g, '_')}.png`)).catch(() => {});
    }
  }
  await page.close();
}

let exitCode = 0;
try {
  // The first visit compiles the app; do it alone so the others don't time out.
  await worker(1);
  await Promise.all(Array.from({ length: Math.min(Number(args.jobs), jobs.length) }, worker));
} catch (err) {
  console.error(err);
  exitCode = 2;
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => r.problems.length);
const missing = [...new Set(serverLog.filter((l) => l.startsWith('MISSING') || l.startsWith('FIXTURE ERROR')))];
if (missing.length) {
  console.log('\nServer log:');
  for (const l of missing) console.log(`  ${l.split('\n')[0]}`);
}
console.log(`\n${results.length - failed.length}/${results.length} screens passed in ${Math.round((Date.now() - started) / 1000)} s.`);
if (failed.length) console.log(`Screenshots of the failures: ${outDir}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results
    .sort((a, b) => SCREENS.findIndex((s) => s.path === a.path) - SCREENS.findIndex((s) => s.path === b.path))
    .map((r) => `| ${r.problems.length ? '❌' : '✅'} | ${r.screen} | \`${r.path}\` | ${PERSONAS[r.as].label} | ${r.problems.map((p) => p.replace(/\|/g, '\\|')).join('<br>')} |`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Screen smoke test: ${results.length - failed.length}/${results.length} passed\n\n| | Screen | Path | As | Problems |\n|---|---|---|---|---|\n${rows.join('\n')}\n`);
}

process.exit(exitCode || (failed.length || results.length < jobs.length ? 1 : 0));
