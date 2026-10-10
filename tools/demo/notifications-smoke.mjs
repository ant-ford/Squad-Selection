// Exercise Notify on fictional data; push-service results are fulfilled locally by CDP.
import assert from 'node:assert/strict';
import { launchBrowser } from './cdp.mjs';
import { startDemoServer } from './server.mjs';

const server = await startDemoServer({ port: 5199, quiet: true });
let browser;
try {
  browser = await launchBrowser({ port: 9341 });
  const page = await browser.newPage({ scale: 1 });
  const problems = [];
  const requests = [];
  let noticed = 0;
  let result;
  page.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') problems.push('Browser exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push('Browser console error');
    if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/api/squad/notified')) noticed++;
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    let body;
    if (request.url.includes('/api/push/config')) body = { enabled: true, publicKey: 'demo' };
    else {
      requests.push(JSON.parse(request.postData));
      body = result;
    }
    void page.send('Fetch.fulfillRequest', {
      requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
    }).catch((err) => problems.push(String(err)));
  });
  await page.send('Fetch.enable', { patterns: [
    { urlPattern: '*/demo-api/api/push/config*', requestStage: 'Request' },
    { urlPattern: '*/demo-api/api/push/squad', requestStage: 'Request' },
  ] });
  await page.goto('http://127.0.0.1:5199/coach/match/demoM1-home?as=coach');
  await page.click('Notify');
  const base = { players: 12, people: 12, devices: 12, reached: 0, pruned: 0, skipped: 0 };
  const cases = [
    { result: { ...base, people: 0, devices: 0 }, text: 'no selected players have a registered device' },
    { result: { ...base, pruned: 12 }, text: 'expired registrations' },
    { result: base, text: "couldn't be delivered" },
    { result: { ...base, reached: 1 }, text: 'Sent to 1 of 12 selected players' },
    { result: { ...base, reached: 12 }, text: 'Sent to 12 players' },
  ];
  for (const test of cases) {
    result = test.result;
    await page.click('Send to Eddy app');
    await page.settle();
    const status = await page.eval(`return document.querySelector('[role="dialog"] [role="status"]')?.innerText`);
    assert.ok(status?.includes(test.text), `Expected persistent send feedback: ${test.text}; got ${status}`);
    assert.ok(!(await page.eval('return document.body.innerText')).includes('Sent to 0 players'));
    if (!result.reached) assert.equal(noticed, 0, 'a zero-delivery result must not mark the squad notified');
    console.log(`ok   Notify feedback: ${test.text}`);
  }
  assert.equal(noticed, 1, 'successful sends remember the squad once per sheet');
  assert.deepEqual(requests, cases.map(() => ({ matchId: 'demoM1-home', side: 'home' })));
  assert.deepEqual(problems, []);
  await page.close();
  console.log('5/5 notification feedback browser scenarios passed; no real push service was contacted.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
