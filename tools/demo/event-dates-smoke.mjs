// Date polls and final RSVPs on the real frontend, with fictional people only.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { launchBrowser } from './cdp.mjs';
import { startDemoServer } from './server.mjs';

const { values } = parseArgs({ options: { out: { type: 'string', default: path.join(os.tmpdir(), 'eddy-event-dates') } } });
const server = await startDemoServer({ port: 5204, quiet: true });
let browser;
try {
  browser = await launchBrowser({ port: 9346 });
  const page = await browser.newPage({ scale: 1 });
  const problems = [];
  const saves = [];
  page.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') problems.push('Browser exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push('Browser console error');
    if (message.method === 'Page.javascriptDialogOpening') void page.send('Page.handleJavaScriptDialog', { accept: true });
    if (message.method === 'Network.requestWillBeSent') {
      const r = message.params.request;
      if (r.method === 'POST' && new URL(r.url).pathname.endsWith('/api/events')) saves.push(JSON.parse(r.postData));
    }
  });
  const goto = (url) => page.goto(`http://127.0.0.1:5204${url}`);
  const text = () => page.eval('return document.body.innerText');
  const set = async (selector, value) => {
    await page.eval(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing field: ' + ${JSON.stringify(selector)});
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));`);
    assert.equal(await page.settle(), true);
  };
  const day = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const one = `${day(7)}T19:00`;
  const two = `${day(10)}T19:00`;
  const dateReply = async (i, label) => {
    await page.eval(`const group = [...document.querySelectorAll('section[aria-label="Date availability"] [role=radiogroup]')][${i}];
      [...group.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(label)}).click();`);
    await page.settle();
  };

  await goto('/events/manage/new?as=social-secretary');
  await set('#event-title', 'C team social: choose a date');
  await set('[aria-label="Event scheduling"]', 'poll');
  await set('#event-date-0-start', one);
  await set('#event-date-1-start', one);
  await page.click('Save draft', { exact: true });
  assert.match(await text(), /Proposed dates must be different/);
  assert.equal(saves.length, 0);
  await set('#event-date-1-start', two);
  await page.click('Add a date', { exact: true });
  assert.equal(await page.eval('return !!document.querySelector("#event-date-2-start")'), true);
  await page.click('Remove date 3', { exact: true });
  assert.equal(await page.eval('return !!document.querySelector("#event-date-2-start")'), false);
  await page.screenshot(path.join(values.out, 'poll-create-mobile.png'));
  await page.click('Save draft', { exact: true });
  await page.settle();
  assert.equal(saves.at(-1).type, 'team_social');
  assert.equal(saves.at(-1).team, 'HKFC C');
  assert.equal(saves.at(-1).dateOptions.length, 2);
  await page.click('Publish', { exact: true });
  await page.settle();
  assert.match(await text(), /Date to be agreed · 2 options/);
  assert.equal(await page.eval('return document.querySelector("#event-date-0-start").disabled'), true);
  assert.doesNotMatch(await text(), /Check-in QR code/);
  console.log('ok   A team social secretary can publish a date poll; duplicate dates are refused and published dates stay fixed');

  await goto('/?event=demoPoll&as=player');
  assert.match(await text(), /Which dates can you make/);
  assert.doesNotMatch(await text(), /Are you coming\?|Your bill|Other players you're signing up/);
  await dateReply(0, 'Available');
  assert.equal(await page.eval(`return [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Save dates').disabled`), true);
  await dateReply(1, 'Maybe');
  await page.click('Save dates', { exact: true });
  await page.settle();
  assert.match(await text(), /Your dates are saved/);
  await page.screenshot(path.join(values.out, 'poll-answer-mobile.png'));
  await goto('/?event=demoPoll&as=coach');
  await dateReply(0, 'No');
  await dateReply(1, 'Available');
  await page.click('Save dates', { exact: true });
  await page.settle();
  console.log('ok   Invitees answer every date; availability is saved without an attendance RSVP or bill');

  await goto('/events/manage/demoPoll?tab=dates&as=social-secretary');
  assert.match(await text(), /2 replied/);
  const cards = () => page.eval(`return [...document.querySelectorAll('section[aria-label="Date replies"] article')].map((a) => a.innerText)`);
  assert.match((await cards())[0], /Available: 1.*Maybe: 0.*No: 1/s);
  assert.match((await cards())[1], /Available: 1.*Maybe: 1.*No: 0/s);
  await page.click('Show names', { nth: 0 });
  assert.match((await cards())[0], /Available: Sam Carter/);
  assert.match((await cards())[0], /No: Jo Bennett/);
  await page.screenshot(path.join(values.out, 'poll-results-mobile.png'));
  console.log('ok   Organiser compares per-date totals and names, with No and unanswered separate');

  await page.click('Choose this date', { nth: 1 });
  assert.match(await text(), /Available replies for this date will carry over as Going/);
  await page.click('Cancel', { exact: true });
  assert.match(await text(), /Choose a date/);
  await page.click('Choose this date', { nth: 1 });
  await page.click('Choose date', { exact: true });
  await page.settle();
  assert.match(await text(), /Date chosen/);
  assert.doesNotMatch(await text(), /Choose this date/);
  assert.match(await text(), /Answers \(1\)/);
  await page.click('Details', { selector: '[role=tab]', exact: true });
  assert.equal(await page.eval('return document.querySelector("#event-starts").value'), two);
  assert.equal(await page.eval('return document.querySelector("#event-starts").disabled'), true);
  assert.equal(await page.eval("return [...document.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === 'Event scheduling').value"), 'fixed');
  await page.click('Date replies (2)', { selector: '[role=tab]', exact: true });
  await page.setViewport(1280, 900, 1);
  await page.screenshot(path.join(values.out, 'poll-chosen-desktop.png'));
  console.log('ok   Choosing a date requires confirmation, closes the poll and preserves its comparison');

  await page.setViewport(390, 844, 1);
  await goto('/?event=demoPoll&as=player');
  assert.doesNotMatch(await text(), /Which dates can you make|Date to be agreed/);
  assert.match(await text(), /Are you coming\?/);
  assert.equal(await page.eval('return document.querySelectorAll("[role=radio][aria-checked=true]").length'), 0);
  await page.click('Going', { selector: '[role=radio]', exact: true });
  await page.click('Save', { exact: true });
  await page.settle();
  assert.match(await text(), /Going/);
  await goto('/?event=demoPoll&as=player');
  assert.equal(await page.eval("return [...document.querySelectorAll('section')].some((s) => s.getAttribute('aria-label') === 'Date availability')"), false);
  assert.match(await text(), /Going/);
  assert.equal(await page.eval('return document.documentElement.scrollWidth <= innerWidth'), true);
  await goto('/?event=demoPoll&as=coach');
  assert.match(await text(), /Going/);
  await page.click('Change', { exact: true });
  assert.equal(await page.eval("return [...document.querySelectorAll('[role=radio]')].find((b) => b.innerText.trim() === 'Going').getAttribute('aria-checked')"), 'true');
  await page.click('Not going', { selector: '[role=radio]', exact: true });
  await page.click('Save', { exact: true });
  await page.settle();
  await goto('/?event=demoPoll&as=coach');
  assert.match(await text(), /Not going/);
  await page.click('Change', { exact: true });
  assert.equal(await page.eval("return [...document.querySelectorAll('[role=radio]')].find((b) => b.innerText.trim() === 'Not going').getAttribute('aria-checked')"), 'true');
  console.log('ok   Available carries over as Going; Maybe still needs an RSVP and carried-over answers can change');

  await goto('/events/manage/new?as=section-captain');
  await set('[aria-label="Type"]', 'admin_meeting');
  await set('[aria-label="Event scheduling"]', 'poll');
  assert.match(await text(), /Captains' Meeting/);
  assert.equal(await page.eval('return document.querySelectorAll("#event-proposed-dates input[type=datetime-local]").length'), 4);
  assert.deepEqual(problems, []);
  console.log('ok   The same date poll controls are available for admin meetings without browser errors');
  await page.close();
} finally {
  await browser?.close();
  await server.close();
}
