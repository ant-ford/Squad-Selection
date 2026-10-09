// Hold real demo API requests to check the ball-to-data handoff on cold opens.
import assert from 'node:assert/strict';
import { launchBrowser } from './cdp.mjs';
import { startDemoServer } from './server.mjs';

const server = await startDemoServer({ port: 5198, quiet: true });
let browser;
try {
  browser = await launchBrowser({ port: 9340 });
  const waitFor = async (page, predicate) => {
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      if (await predicate()) return;
      await page.sleep(100);
    }
    throw new Error('Timed out waiting for startup state');
  };
  const visibleState = (page) => page.eval(`
    const visible = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    return {
      ball: [...document.querySelectorAll('[aria-label="Loading Eddy"]')].some(visible),
      placeholders: [...document.querySelectorAll('#root .animate-pulse')].some(visible),
      text: document.body.innerText,
    };
  `);
  const cases = [
    { url: '/?as=player', api: 'my-fixtures', text: 'My team' },
    { url: '/coach?as=coach', api: 'upcoming-fixtures', text: 'HKFC C' },
    { url: '/coach/availability?as=coach', api: 'team-attendance', text: 'Team availability' },
    { url: '/kit?as=kit-convenor', api: 'kit/board', text: 'Collections and handovers' },
    { url: '/umpiring?as=umpire-coordinator', api: 'umpiring', text: 'Needs attention' },
  ];
  for (const test of cases) {
    const page = await browser.newPage({ scale: 1 });
    const held = [];
    const problems = [];
    let hold = true;
    page.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') problems.push('Browser exception');
      if (message.method === 'Fetch.requestPaused') {
        if (hold) held.push(message.params.requestId);
        else void page.send('Fetch.continueRequest', { requestId: message.params.requestId }).catch((err) => problems.push(String(err)));
      }
    });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: `*/demo-api/api/${test.api}*`, requestStage: 'Request' }] });
    await page.send('Page.navigate', { url: `http://127.0.0.1:5198${test.url}` });
    await waitFor(page, () => held.length > 0);
    await page.sleep(500); // Other reads, including the fast profile, have time to finish.
    const loading = await visibleState(page);
    assert.equal(loading.ball, true, `${test.url}: ball must remain while primary data is held`);
    assert.equal(loading.placeholders, false, `${test.url}: placeholders must stay out of view`);
    hold = false;
    for (const requestId of held.splice(0)) await page.send('Fetch.continueRequest', { requestId });
    await page.settle();
    await waitFor(page, async () => !(await visibleState(page)).ball);
    const ready = await visibleState(page);
    assert.equal(ready.placeholders, false);
    assert.ok(ready.text.toLowerCase().includes(test.text.toLowerCase()), `${test.url}: loaded screen must be visible`);

    if (test.api === 'my-fixtures') {
      // Cached data stays visible during a later refresh; the startup screen never returns.
      hold = true;
      await page.eval(`const { queryClient } = await import('/src/lib/queryClient.ts'); void queryClient.invalidateQueries({ queryKey: ['myFixtures'] });`);
      await waitFor(page, () => held.length > 0);
      const refreshing = await visibleState(page);
      assert.equal(refreshing.ball, false);
      assert.ok(refreshing.text.toLowerCase().includes('my team'));
      hold = false;
      for (const requestId of held.splice(0)) await page.send('Fetch.continueRequest', { requestId });
      await page.settle();
    }
    assert.deepEqual(problems, []);
    await page.close();
    console.log(`ok   ${test.url}: ball stays until data is ready, without visible placeholders`);
  }

  const page = await browser.newPage({ scale: 1 });
  let fail = true;
  page.on((message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const requestId = message.params.requestId;
    void page.send(fail ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest', fail ? {
      requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ error: 'Demo temporarily unavailable' })).toString('base64'),
    } : { requestId });
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/demo-api/api/my-fixtures*', requestStage: 'Request' }] });
  await page.goto('http://127.0.0.1:5198/?as=player');
  await waitFor(page, async () => (await visibleState(page)).text.includes('Could not load your fixtures'));
  assert.equal((await visibleState(page)).ball, false);
  fail = false;
  await page.click('Try again');
  await page.settle();
  assert.ok((await visibleState(page)).text.toLowerCase().includes('my team'));
  await page.close();
  console.log('ok   failed startup reads reveal retry controls and recover without reloading');
  console.log('6/6 startup browser scenarios passed (including cached refresh and retry).');
} finally {
  if (browser) await browser.close();
  await server.close();
}
