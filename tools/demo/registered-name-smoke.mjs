// Officers edit only fictional People records; no external database is used.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { launchBrowser } from './cdp.mjs';
import { startDemoServer } from './server.mjs';

const { values } = parseArgs({ options: { out: { type: 'string', default: path.join(os.tmpdir(), 'eddy-registered-name') } } });
const out = path.resolve(values.out);
const server = await startDemoServer({ port: 5202, quiet: true });
let browser;
try {
  browser = await launchBrowser({ port: 9344 });
  const page = await browser.newPage({ scale: 1 });
  const problems = [];
  const requests = [];
  let failSuggestions = false;
  page.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') problems.push('Uncaught browser exception');
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.method === 'Fetch.requestPaused') {
      const { requestId } = message.params;
      void (failSuggestions ? page.send('Fetch.fulfillRequest', {
        requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ error: 'TEMPORARILY_UNAVAILABLE', message: 'Temporarily unavailable' })).toString('base64'),
      }) : page.send('Fetch.continueRequest', { requestId })).catch((err) => problems.push(String(err)));
    }
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/demo-api/api/admin/people/*/registered-name-suggestions' }] });
  const goto = (as) => page.goto(`http://127.0.0.1:5202/people/demoP102?as=${as}`);
  const text = () => page.eval('return document.body.innerText');
  const field = () => page.eval(`return document.querySelector('section[aria-label="HockeyHK registration"] input')?.value`);
  const type = async (value) => {
    await page.eval(`const el = document.querySelector('section[aria-label="HockeyHK registration"] input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));`);
    await page.settle();
  };
  await goto('mens-convenor');
  const options = await page.eval(`return [...document.querySelectorAll('section[aria-label="HockeyHK registration"] select option')].map((o) => ({ value: o.value, text: o.textContent }))`);
  assert.deepEqual(options.slice(1).map((o) => o.value), ['REID Tom', 'REID Thomas']);
  assert.match(options[1].text, /3 match cards.*HKFC D/);
  await page.eval(`const el = document.querySelector('section[aria-label="HockeyHK registration"] select'); el.value = 'REID Tom'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
  await page.settle();
  assert.equal(await field(), 'REID Tom');
  assert.equal(await page.eval(`return (await (await fetch('/demo-api/api/admin/people/demoP102', { headers: { Authorization: 'Bearer demo.mens-convenor' } })).json()).registeredName`), null);
  await page.fullPage(path.join(out, 'ranked-suggestions-mobile.png'));
  console.log('ok   blank name offers ranked suggestions with evidence; selecting only fills the draft');

  await page.click('Save registered name', { exact: true });
  await page.settle();
  assert.equal(await field(), 'REID Tom');
  assert.match(await text(), /3 match cards linked/);
  assert.equal(await page.eval(`return !!document.querySelector('section[aria-label="HockeyHK registration"] select')`), false);
  console.log('ok   confirmed save updates the field and reports linked cards');

  await type('REID Thomas');
  await page.click('Save registered name', { exact: true });
  await page.settle();
  assert.equal(await field(), 'REID Thomas');
  await type('TAKEN Name');
  await page.click('Save registered name', { exact: true });
  await page.settle();
  assert.match(await text(), /Another player already has this registered name/);
  assert.equal(await page.eval(`return [...document.querySelectorAll('section[aria-label="HockeyHK registration"] button')].some((b) => b.textContent.trim() === 'Reload')`), false);
  await page.click('Undo', { selector: 'section[aria-label="HockeyHK registration"] button', exact: true });
  assert.equal(await field(), 'REID Thomas');
  console.log('ok   existing names can be changed; duplicate refusals preserve the draft and Undo restores the stored name');

  await type('REID Tommy');
  await page.eval(`await fetch('/demo-api/api/admin/people/demoP102/registered-name', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo.mens-convenor' }, body: JSON.stringify({ registeredName: 'REID Thomas James', expect: { registeredName: 'REID Thomas' } }) });`);
  await page.click('Save registered name', { exact: true });
  await page.settle();
  assert.match(await text(), /Someone else changed this/);
  await page.click('Reload', { selector: 'section[aria-label="HockeyHK registration"] button', exact: true });
  await page.settle();
  assert.equal(await field(), 'REID Thomas James');
  console.log('ok   an edit saved by someone else requires Reload and preserves their name');

  for (const as of ['membership-officer', 'section-captain']) {
    requests.length = 0;
    await goto(as);
    assert.match(await text(), /REID Thomas James/);
    assert.equal(await field(), undefined);
    assert.equal(requests.some((url) => url.includes('registered-name-suggestions')), false);
  }
  await page.fullPage(path.join(out, 'read-only-mobile.png'));
  console.log('ok   other People officers see the recorded name without editor or suggestion requests');

  await goto('mens-convenor');
  await type('');
  await page.click('Save registered name', { exact: true });
  await page.settle();
  assert.equal(await field(), '');
  assert.equal(await page.eval(`return !!document.querySelector('section[aria-label="HockeyHK registration"] select')`), true);
  console.log('ok   clearing a name brings back the suggestions');

  failSuggestions = true;
  await goto('mens-convenor');
  assert.match(await text(), /Suggested names didn’t load/);
  await type('REID Tom');
  assert.match(await text(), /Save registered name/);
  failSuggestions = false;
  await page.click('Retry suggestions', { exact: true });
  await page.settle();
  assert.equal(await field(), 'REID Tom');
  assert.equal(await page.eval(`return !!document.querySelector('section[aria-label="HockeyHK registration"] select')`), true);
  console.log('ok   failed suggestions allow manual entry and recover without losing the draft');

  for (const width of [320, 390, 1024]) {
    await page.setViewport(width, 844, 1);
    assert.equal(await page.eval('return document.documentElement.scrollWidth > innerWidth'), false, `page overflow at ${width}px`);
  }
  await page.fullPage(path.join(out, 'editor-desktop.png'));
  assert.deepEqual(problems, []);
  console.log('ok   editor and suggestions fit mobile/desktop without uncaught browser exceptions');
  await page.close();
  console.log('8/8 registered-name browser scenarios passed.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
