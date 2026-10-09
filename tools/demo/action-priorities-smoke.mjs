// Exercise urgent Kit and Umpiring actions using fictional demo data only.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { launchBrowser } from './cdp.mjs';
import { startDemoServer } from './server.mjs';

const { values } = parseArgs({ options: { out: { type: 'string', default: path.join(os.tmpdir(), 'eddy-action-priorities') } } });
const out = path.resolve(values.out);
const server = await startDemoServer({ port: 5196, quiet: true });
let browser;
try {
  browser = await launchBrowser({ port: 9339 });
  const page = await browser.newPage({ width: 390, height: 844, scale: 1 });
  const problems = [];
  page.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') problems.push('Uncaught browser exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push('Browser console error');
  });
  const goto = (url) => page.goto(`http://127.0.0.1:5196${url}`);
  const text = () => page.eval('return document.body.innerText');
  const numbers = () => page.eval(`return [...document.querySelectorAll('ul[aria-label="Kit sets"] > li > button')].map((el) => Number(el.firstElementChild.textContent))`);
  await goto('/kit?as=kit-convenor');
  assert.deepEqual((await numbers()).slice(0, 3), [5, 8, 34]); // Older collections precede delivered kit and spares.
  assert.match(await text(), /Arrange collection · \d+ days since arrival/);
  assert.match(await text(), /Hand over to owner · \d+ days with holder/);
  assert.match(await text(), /Chase confirmation from Dylan Cheung · \d+ days awaiting confirmation/);
  console.log('ok   Kit shows next actions and their stage ages, with oldest collections first');
  await page.screenshot(path.join(out, 'kit-mobile.png'));

  await page.eval(`const el = document.querySelector('select[aria-label="Sort kit"]'); el.value = 'number'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
  await page.settle();
  assert.deepEqual((await numbers()).slice(0, 3), [3, 5, 8]);
  await goto('/kit?as=kit-convenor&show=with_holder');
  assert.equal((await numbers())[0], 72); // The oldest outstanding handover.
  await page.click('Sam Carter');
  assert.match(await text(), /With Ben Hughes/);
  console.log('ok   Kit retains number sorting, filters and set actions');

  await goto('/umpiring?as=umpire-coordinator');
  const attention = await page.eval(`return document.querySelector('section[aria-label="Duties needing attention"]').innerText`);
  assert.match(attention, /5 uncovered · 1 with timing conflicts/);
  assert.match(attention, /Timing conflict · Karan is playing at 13:00/);
  assert.ok(attention.indexOf('Khalsa A vs Valley A') < attention.indexOf('Kowloon CC B vs Dragons B'));
  assert.ok(attention.indexOf('Kowloon CC B vs Dragons B') < attention.indexOf('Punjab B vs Tigers B'));
  assert.ok(attention.indexOf('Tigers vs Shaheen B') < attention.indexOf('Khalsa B vs Valley C')); // TBC after timed duties.
  assert.doesNotMatch(attention, /Dragons vs Shaheen|Dragons vs Punjab/); // Covered/cancelled stay in the week.
  const elsewhere = await page.eval(`return document.querySelector('section[aria-label="Other duties"]').innerText`);
  assert.doesNotMatch(elsewhere, /Khalsa A vs Valley A|Punjab B vs Tigers B/); // Each duty appears once.
  assert.match(attention, /Confirm|Assign/);
  console.log('ok   Umpiring promotes uncovered duties and actual timing conflicts, soonest first, with their controls');
  await page.screenshot(path.join(out, 'umpiring-mobile.png'));

  // Removing an assignment changes the attention reason immediately; Undo restores it.
  await page.eval(`
    const card = [...document.querySelectorAll('section[aria-label="Duties needing attention"] li')].find((el) => el.innerText.includes('Punjab B vs Tigers B'));
    [...card.querySelectorAll('button')].find((el) => el.innerText.trim() === 'Remove').click();
  `);
  await page.click('Undo', { wait: 100 });
  assert.match(await text(), /Timing conflict · Karan is playing at 13:00/);
  await goto('/umpiring?as=umpire');
  assert.match(await text(), /Timing conflict · Your game 14:30 HKFC C vs Valley B/);
  assert.match(await text(), /Take anyway/);
  await goto('/umpiring?as=umpire-coordinator');
  await page.click('Previous week');
  assert.doesNotMatch(await text(), /Needs attention/); // A completed week remains a normal chronological list.
  console.log('ok   Umpiring retains Undo, the umpire taking flow and historical weeks');

  for (const url of ['/kit?as=kit-convenor', '/umpiring?as=umpire-coordinator']) {
    await goto(url);
    for (const width of [320, 390, 1024]) {
      await page.setViewport(width, 844, 1);
      assert.equal(await page.eval('return document.documentElement.scrollWidth > innerWidth'), false, `${url} overflow at ${width}px`);
    }
  }
  await page.screenshot(path.join(out, 'umpiring-desktop.png'));
  assert.deepEqual(problems, []);
  console.log('ok   Kit and Umpiring fit mobile and desktop without browser errors');
  await page.close();
  console.log('5/5 action priority browser scenarios passed.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
