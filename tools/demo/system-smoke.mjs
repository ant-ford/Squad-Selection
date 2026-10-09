// The System screen's period selection, grouped counts and diagnostic details.
// Uses only the fictional demo fixtures.
import assert from 'node:assert/strict';
import { launchBrowser } from './cdp.mjs';
import { startDemoServer } from './server.mjs';

const server = await startDemoServer({ port: 5194, quiet: true });
let browser;
try {
  browser = await launchBrowser({ port: 9337 });
  const page = await browser.newPage({ scale: 1 });
  await page.goto('http://127.0.0.1:5194/system?as=section-captain');
  const text = () => page.eval('return document.body.innerText');
  assert.match(await text(), /Last 24 hours: 3 issues, 3 occurrences/);
  assert.equal(await page.eval('return document.documentElement.scrollWidth > innerWidth'), false);
  console.log('ok   System defaults to the last 24 hours');

  const period = async (days) => {
    await page.eval(`
      const select = document.querySelector('select');
      select.value = '${days}';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await page.settle();
  };
  await period(7);
  assert.match(await text(), /Last 7 days: 3 issues, 19 occurrences/);
  await page.click('Screen-loading failure', { selector: 'summary' });
  assert.match(await text(), /17 occurrences/);
  assert.match(await text(), /\/umpiring/);
  assert.match(await text(), /demo-current/);
  assert.match(await text(), /Safari 17/);
  assert.match(await text(), /First in this period/);
  assert.match(await text(), /reading 'default'/);
  console.log('ok   repeated errors expand to original messages, routes and build/browser details');

  await period(30);
  assert.match(await text(), /Last 30 days: 4 issues, 20 occurrences/);
  assert.match(await text(), /Not seen in the last 24 hours/);
  assert.doesNotMatch(await text(), /Issue resolved|Fixed automatically/);
  console.log('ok   older reports remain history without a false resolution status');
  await page.close();
  console.log('3/3 System screen scenarios passed.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
