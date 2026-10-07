// Takes a guide's screenshots on the demo data, at phone width, as WebP.
//   node tools/demo/shots/run.mjs <guide> <out-dir> [--only <name>] [--port 5196]
// <guide> is a spec file here (players, coaches, kit, events, convenor, ...);
// <out-dir> is usually the eddy-site checkout's guides/img.
//
// A spec's default export is a list of shots:
//   { name, as, path, steps?: async (page) => {}, el?: '<page expression>', pad?, full? }
// The shot is the viewport, the whole page (full) or the element(s) the `el`
// expression returns. `steps` opens menus or sheets first (page.click,
// page.openMenu, page.eval: see ../cdp.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { startDemoServer } from '../server.mjs';
import { launchBrowser } from '../cdp.mjs';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { only: { type: 'string' }, port: { type: 'string', default: '5196' } },
});
const [guide, outArg] = positionals;
if (!guide || !outArg) throw new Error('usage: node tools/demo/shots/run.mjs <guide> <out-dir> [--only <name>]');
const outDir = path.resolve(outArg); // before the server changes the cwd
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = (await import(pathToFileURL(path.join(here, `${guide}.mjs`)).href)).default
  .filter((s) => !args.only || s.name === args.only || s.name.startsWith(`${args.only}`));
if (!shots.length) throw new Error('No shot matches.');

const port = Number(args.port);
const server = await startDemoServer({ port, quiet: true, log: (l) => console.log(`  server: ${l.split('\n')[0]}`) });
const browser = await launchBrowser({ port: port + 1000 });
fs.mkdirSync(outDir, { recursive: true });
let failed = 0;
try {
  const page = await browser.newPage();
  for (const s of shots) {
    try {
      await page.goto(`http://127.0.0.1:${port}${s.path}${s.path.includes('?') ? '&' : '?'}as=${s.as}`);
      if (s.steps) {
        await s.steps(page);
        await page.settle();
      }
      const png = path.join(outDir, `${s.name}.png`);
      if (s.el) await page.element(png, s.el, s.pad ?? 12);
      else if (s.full) await page.fullPage(png);
      else await page.screenshot(png);
      await page.toWebp(png);
      console.log(`saved ${s.name}.webp`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${s.name}: ${err.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
