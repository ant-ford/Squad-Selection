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
      if (season === previous && mode === 'partial') {
        data.results.forEach((result, i) => { if (i >= 4) delete result.matchCards; });
      }
      if (season === previous && mode === 'noCards') data.results.forEach((result) => { delete result.matchCards; });
      if (season === previous && mode === 'failed') {
        await page.send('Fetch.fulfillRequest', { requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ error: 'Temporarily unavailable' })).toString('base64') });
        return;
      }
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
  assert.match(await text(), new RegExp(`through 10 Oct ${year}, and the equivalent date in each past season`));
  assert.deepEqual((await comparisonRows())[0], ['Games', '20', '20', '20', '20']); // Five weeks, not last season's 18 weeks.
  const headers = await page.eval(`return [...document.querySelectorAll('section[aria-label="Previous season comparison"] thead th')].map((c) => c.textContent.trim())`);
  assert.deepEqual(headers, ['Measure', ...[0, 1, 2, 3].map((n) => seasonLabel(year - n))]);
  assert.ok((await comparisonRows()).some((r) => r[0] === 'Goals conceded per game' && r.slice(1).every((v) => /^\d+\.\d$/.test(v))));
  assert.ok((await comparisonRows()).some((r) => r[0] === 'Clean sheets' && r.slice(1).every((v) => /^\d+$/.test(v))));
  assert.deepEqual((await comparisonRows()).find((r) => r[0] === 'Yellow (red) cards'), ['Yellow (red) cards', '8 (0)', '8 (0)', '8 (0)', '8 (0)']);
  assert.ok(!(await comparisonRows()).some((r) => /attendance/i.test(r[0])));
  const leagueCard = await page.eval(`const figure = [...document.querySelectorAll('figure')].find((f) => f.querySelector('h3')?.textContent === 'By league'); return { table: !!figure?.querySelector('table'), toggle: !!figure?.querySelector('button'), chart: !!figure?.querySelector('[role="img"]') };`);
  assert.deepEqual(leagueCard, { table: true, toggle: false, chart: false });
  await page.screenshot(path.join(out, 'stats-club-mobile.png'));
  console.log('ok   Club Stats uses saved HKT compilation time and compares matched periods');

  await page.click('Teams', { selector: '[role=tab]', exact: true });
  assert.equal(await page.settle(), true);
  assert.deepEqual((await comparisonRows())[0], ['Games', '5', '5', '5', '5']);
  await page.click('B', { selector: 'nav[aria-label="Team"] button', exact: true });
  assert.match(await text(), /HKFC B's games, including derbies/);
  assert.deepEqual((await comparisonRows())[0], ['Games', '5', '5', '5', '5']);
  await page.screenshot(path.join(out, 'stats-team-mobile.png'));
  console.log('ok   Team comparisons follow the team picker');

  await chooseSeason(previous);
  assert.match(await text(), /Full seasons/);
  assert.deepEqual((await comparisonRows())[0], ['Games', '18', '18', '18', '18']);
  assert.match(await text(), new RegExp(seasonLabel(year - 2)));
  console.log('ok   Historical comparisons use four completed seasons');

  mode = 'empty';
  await goto('/stats?as=player');
  assert.match(await text(), new RegExp(`${seasonLabel(year - 1)}: No recorded games in this period`));
  assert.deepEqual((await comparisonRows())[0], ['Games', '20', '0', '20', '20']);
  assert.equal((await comparisonRows())[1][2], '—');
  assert.match(await text(), /W-D-L/); // Current figures remain available.
  assert.doesNotMatch(await text(), /NaN|Infinity/);
  console.log('ok   Empty prior periods explain the missing comparison');

  mode = 'undated';
  await goto('/stats?as=player');
  assert.match(await text(), /Dated results missing/);
  assert.deepEqual((await comparisonRows())[0], ['Games', '20', '—', '20', '20']);
  console.log('ok   Older summaries without dated results do not invent a comparison');

  mode = 'partial';
  await goto('/stats?as=player');
  assert.doesNotMatch(await text(), /games have match cards|Card counts use those games only|Cards are counts, with red cards in brackets|Recorded games may differ between seasons/);
  assert.equal((await comparisonRows()).find((r) => r[0] === 'Yellow (red) cards')[2], '4 (0)');
  console.log('ok   Partial card totals remain visible without coverage notes or the footer');

  mode = 'noCards';
  await goto('/stats?as=player');
  assert.match(await text(), /Card counts unavailable/);
  assert.equal((await comparisonRows()).find((r) => r[0] === 'Yellow (red) cards')[2], '—');
  assert.notEqual((await comparisonRows()).find((r) => r[0] === 'Clean sheets')[2], '—');
  console.log('ok   Results-only history keeps results and labels missing match-card figures');

  mode = 'failed';
  await goto('/stats?as=player');
  // React Query retries once before offering the per-season retry button.
  for (let attempt = 0; attempt < 20 && !/Could not load/.test(await text()); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.match(await text(), new RegExp(`${seasonLabel(year - 1)}: Could not load`));
  assert.deepEqual((await comparisonRows())[0], ['Games', '20', '—', '20', '20']);
  mode = 'normal';
  await page.click('Try again', { selector: 'section[aria-label="Previous season comparison"] button', exact: true });
  assert.equal(await page.settle(), true);
  assert.deepEqual((await comparisonRows())[0], ['Games', '20', '20', '20', '20']);
  console.log('ok   A failed historical request preserves other seasons and retries');

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
  console.log('10/10 Ranking and Stats browser scenarios passed.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
