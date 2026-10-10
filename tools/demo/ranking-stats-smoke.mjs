// Ranking and Stats checks use only fictional demo responses.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { launchBrowser } from './cdp.mjs';
import { startDemoServer } from './server.mjs';

const { values } = parseArgs({ options: { out: { type: 'string', default: path.join(os.tmpdir(), 'eddy-ranking-stats') } } });
const out = path.resolve(values.out);
const now = new Date();
// Match the demo's season seed, then pin the browser to October in that season.
const year = now.getUTCFullYear() - (now.getUTCMonth() < 7 ? 1 : 0);
const current = `${year}-${year + 1}`;
const previous = `${year - 1}-${year}`;
const seasonLabel = (start) => `${start}-${String(start + 1).slice(2)}`;
const server = await startDemoServer({ port: 5200, quiet: true });
let browser;
try {
  browser = await launchBrowser({ port: 9342 });
  const page = await browser.newPage({ scale: 1 });
  const problems = [];
  let mode = 'normal';
  page.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') problems.push('Uncaught browser exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push('Browser console error');
    if (message.method !== 'Fetch.requestPaused') return;
    void (async () => {
      const { requestId, request } = message.params;
      const response = await page.send('Fetch.getResponseBody', { requestId });
      const data = JSON.parse(response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body);
      const season = new URL(request.url).searchParams.get('season');
      data.generatedAt = season === current ? `${year}-10-09T16:20:00Z` : `${year}-10-03T00:00:00Z`;
      if (season === previous && mode === 'empty') Object.assign(data, { matches: 0, derbies: 0, results: [], teams: [], players: [], umpires: [] });
      if (season === previous && mode === 'undated') delete data.results;
      await page.send('Fetch.fulfillRequest', {
        requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(data)).toString('base64'),
      });
    })().catch((err) => problems.push(String(err)));
  });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const RealDate = Date;
    window.Date = class extends RealDate {
      constructor(...args) { if (args.length) super(...args); else super('${year}-10-10T04:00:00Z'); }
    };
  ` });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/demo-api/api/stats/season*', requestStage: 'Response' }] });
  const goto = (url) => page.goto(`http://127.0.0.1:5200${url}`);
  const text = () => page.eval('return document.body.innerText');
  const comparisonRows = () => page.eval(`return [...document.querySelectorAll('section[aria-label="Previous season comparison"] tbody tr')].map((r) => [...r.children].map((c) => c.textContent.trim()))`);
  const chooseSeason = async (season) => {
    await page.eval(`const el = document.querySelector('select[aria-label="Season"]'); el.value = ${JSON.stringify(season)}; el.dispatchEvent(new Event('change', { bubbles: true }));`);
    assert.equal(await page.settle(), true);
  };

  await goto('/coach/ranking?as=coach');
  const row = await page.eval(`const el = document.querySelector('[data-rank="1"]'); return { text: el?.innerText, move: !!el?.querySelector('[aria-label^="Move "]') };`);
  assert.ok(row.text && /HKFC/.test(row.text) && /GK|DEF|MID|FWD|FLEX/.test(row.text));
  assert.doesNotMatch(row.text, /T#|P#/);
  assert.equal(row.move, true);
  await page.screenshot(path.join(out, 'ranking-mobile.png'));
  console.log('ok   Ranking keeps section rank, team, position and Move; removes T# and P#');

  await goto('/stats?as=player');
  assert.match(await text(), new RegExp(`Stats compiled 10 Oct ${year}, 00:20 HKT`));
  assert.match(await text(), new RegExp(`through 10 Oct ${year} and 10 Oct ${year - 1}`));
  assert.deepEqual((await comparisonRows())[0], ['Games', '20', '20', '0']); // Five weeks, not last season's 18 weeks.
  assert.match((await comparisonRows())[1][3], /pp$/);
  await page.screenshot(path.join(out, 'stats-club-mobile.png'));
  console.log('ok   Club Stats uses saved HKT compilation time and compares matched periods');

  await page.click('Teams', { selector: '[role=tab]', exact: true });
  assert.equal(await page.settle(), true);
  assert.deepEqual((await comparisonRows())[0], ['Games', '5', '5', '0']);
  await page.click('B', { selector: 'nav[aria-label="Team"] button', exact: true });
  assert.match(await text(), /HKFC B's games, including derbies/);
  assert.deepEqual((await comparisonRows())[0], ['Games', '5', '5', '0']);
  await page.screenshot(path.join(out, 'stats-team-mobile.png'));
  console.log('ok   Team comparisons follow the team picker');

  await chooseSeason(previous);
  assert.match(await text(), /Both full seasons/);
  assert.deepEqual((await comparisonRows())[0], ['Games', '18', '18', '0']);
  assert.match(await text(), new RegExp(seasonLabel(year - 2)));
  console.log('ok   Historical comparisons use two completed seasons');

  mode = 'empty';
  await goto('/stats?as=player');
  assert.match(await text(), new RegExp(`No recorded games in ${seasonLabel(year - 1)} against other clubs through 10 Oct ${year - 1} to compare`));
  assert.equal((await comparisonRows()).length, 0);
  assert.match(await text(), /W-D-L/); // Current figures remain available.
  assert.doesNotMatch(await text(), /NaN|Infinity/);
  console.log('ok   Empty prior periods explain the missing comparison');

  mode = 'undated';
  await goto('/stats?as=player');
  assert.match(await text(), /comparison unavailable: dated results are missing/);
  assert.equal((await comparisonRows()).length, 0);
  console.log('ok   Older summaries without dated results do not invent a comparison');

  mode = 'normal';
  await goto('/stats?as=player&season=all');
  assert.equal((await comparisonRows()).length, 0);
  assert.match(await text(), /Season by season/);
  await page.click('stats compiled', { selector: 'details[aria-label="Data freshness"] summary' });
  assert.match(await text(), new RegExp(`${seasonLabel(year - 1)}: 3 Oct ${year}, 08:00 HKT`));
  for (const width of [320, 390, 1024]) {
    await page.setViewport(width, 844, 1);
    assert.equal(await page.eval('return document.documentElement.scrollWidth > innerWidth'), false, `All time overflow at ${width}px`);
  }
  await goto('/stats?as=player');
  for (const width of [320, 390, 1024]) {
    await page.setViewport(width, 844, 1);
    assert.equal(await page.eval('return document.documentElement.scrollWidth > innerWidth'), false, `Comparison overflow at ${width}px`);
  }
  await page.screenshot(path.join(out, 'stats-club-desktop.png'));
  console.log('ok   All time shows per-season freshness; Stats fits phone and desktop');
  assert.deepEqual(problems, []);
  await page.close();
  console.log('7/7 Ranking and Stats browser scenarios passed.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
