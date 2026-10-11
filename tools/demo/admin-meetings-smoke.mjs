// Real Events screens with fictional appointments; no live API or meeting is contacted.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { launchBrowser } from './cdp.mjs';
import { startDemoServer } from './server.mjs';

const { values } = parseArgs({ options: { out: { type: 'string', default: path.join(os.tmpdir(), 'eddy-admin-meetings') } } });
const server = await startDemoServer({ port: 5202, quiet: true });
let browser;
try {
  browser = await launchBrowser({ port: 9344 });
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
  const goto = (url) => page.goto(`http://127.0.0.1:5202${url}`);
  const text = () => page.eval('return document.body.innerText');
  const set = async (selector, value) => {
    await page.eval(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing field');
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));`);
    assert.equal(await page.settle(), true);
  };
  const roles = () => page.eval(`return [...document.querySelectorAll('#event-audience button[aria-pressed=true]')].map((b) => b.innerText.trim())`);

  await goto('/events/manage/new?as=section-captain');
  await set('select[aria-label="Type"]', 'admin_meeting');
  assert.deepEqual(await roles(), ['Team captain', 'Section Captain', 'Assistant Director of Hockey']);
  assert.equal(await page.eval('return document.querySelector("#event-title").value'), "Captains' Meeting");
  assert.doesNotMatch(await text(), /Counts for commitments as/);
  assert.equal(await page.eval('return [...document.querySelectorAll("input[type=checkbox]")].some((el) => el.checked)'), false);
  console.log('ok   Captains meeting selects appointed captains and Assistant Director, free and without guests');

  await set('select[aria-label="Meeting"]', 'mens-sub-committee');
  assert.deepEqual(await roles(), ['Section Captain', "Men's Convenor", 'Membership Officer']);
  assert.match(await text(), /3 people/);
  await page.click('Kit Convenor', { exact: true });
  await page.settle();
  assert.deepEqual(await roles(), ['Section Captain', "Men's Convenor", 'Membership Officer', 'Kit Convenor']);
  assert.match(await text(), /4 people/);
  console.log('ok   Sub-Committee defaults and optional Kit Convenor update the invite count');

  const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await set('#event-starts', `${day}T19:00`);
  await set('[aria-label="Meeting link"]', 'https://hkfc.zoom.us/j/123456?pwd=demo');
  await page.screenshot(path.join(values.out, 'sub-committee-mobile.png'));
  assert.equal(await page.eval('return document.documentElement.scrollWidth <= innerWidth'), true);
  await page.click('Save draft', { exact: true });
  assert.equal(await page.settle(), true);
  assert.ok(saves.length);
  assert.equal(saves.at(-1).type, 'admin_meeting');
  assert.equal(saves.at(-1).socialFunction, null);
  assert.deepEqual(saves.at(-1).audience.eventRoles, ['Section Captain', "Men's Convenor", 'Membership Officer', 'Kit Convenor']);
  assert.equal(saves.at(-1).linkUrl, 'https://hkfc.zoom.us/j/123456?pwd=demo');
  assert.equal(await page.eval('return document.querySelector("select[aria-label=Meeting]").value'), 'mens-sub-committee');
  await page.click('Publish', { exact: true });
  await page.settle();
  assert.match(await text(), /Published/);
  console.log('ok   Saved meeting retains its audience and Zoom link, and can be published');

  await goto('/?event=demoMeeting&as=kit-convenor');
  assert.match(await text(), /Men's Sub-Committee Meeting/);
  assert.equal(await page.eval("return [...document.querySelectorAll('a')].find((a) => a.href.startsWith('https://hkfc.zoom.us'))?.innerText.trim()"), 'Join the Zoom meeting');
  await page.screenshot(path.join(values.out, 'meeting-invite-mobile.png'));
  await goto('/?as=player');
  assert.doesNotMatch(await text(), /Men's Sub-Committee Meeting/);
  console.log('ok   An invited Kit Convenor sees Join the Zoom meeting; an ordinary player does not see the meeting');

  await goto('/events/manage/demoMeeting?as=section-captain');
  await set('[aria-label="Meeting link"]', 'https://teams.microsoft.com/l/meetup-join/demo');
  await page.click('Save', { exact: true });
  await page.settle();
  await goto('/?event=demoMeeting&as=membership-officer');
  assert.equal(await page.eval("return [...document.querySelectorAll('a')].find((a) => a.href.startsWith('https://teams.microsoft.com'))?.innerText.trim()"), 'Join the Teams meeting');
  console.log('ok   A meeting link can be changed to Teams and appears correctly for another invitee');

  await goto('/events/manage/new?as=section-captain');
  await set('select[aria-label="Type"]', 'admin_meeting');
  await set('select[aria-label="Meeting"]', 'hockey-committee');
  assert.deepEqual(await roles(), ['Whole committee']);
  await set('select[aria-label="Meeting"]', '');
  await set('#event-title', 'Budget meeting');
  assert.deepEqual(await roles(), ['Whole committee']);
  await page.setViewport(1280, 900, 1);
  await page.screenshot(path.join(values.out, 'meeting-desktop.png'));
  console.log('ok   Hockey Committee uses its existing group; a custom meeting keeps an editable title and audience');

  await goto('/events/manage/new?as=social-secretary');
  assert.equal(await page.eval('return [...document.querySelectorAll("select[aria-label=Type] option")].some((o) => o.value === "admin_meeting")'), false);
  assert.deepEqual(problems, []);
  console.log('ok   Team social secretaries retain their event types; all meeting flows have no browser errors');
  await page.close();
} finally {
  await browser?.close();
  await server.close();
}
