// Required availability explanations and coach context, on fictional data only.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { launchBrowser } from './cdp.mjs';
import { startDemoServer } from './server.mjs';

const { values } = parseArgs({ options: { out: { type: 'string', default: path.join(os.tmpdir(), 'eddy-availability-notes') } } });
const out = path.resolve(values.out);
const server = await startDemoServer({ port: 5201, quiet: true });
let browser;
try {
  browser = await launchBrowser({ port: 9343 });
  const page = await browser.newPage({ scale: 1 });
  const problems = [];
  const writes = [];
  let attendanceReads = 0;
  let failNext = false;
  let keeper = false;
  page.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') problems.push('Uncaught browser exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push('Browser console error');
    if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/api/player-attendance/')) attendanceReads++;
    if (message.method !== 'Fetch.requestPaused') return;
    void (async () => {
      const { requestId, request } = message.params;
      if (request.url.includes('/api/my-fixtures')) {
        const response = await page.send('Fetch.getResponseBody', { requestId });
        const data = JSON.parse(response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body);
        if (keeper) {
          data.specialGoalkeeperView = true;
          data.playingPosition = 'Goalkeeper';
          data.fixtures = [...data.fixtures, ...data.playUpOpportunities, ...data.supportFixtures];
          data.playUpOpportunities = [];
          data.supportFixtures = [];
        }
        await page.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(data)).toString('base64') });
        return;
      }
      if (request.method !== 'POST') { await page.send('Fetch.continueRequest', { requestId }); return; }
      const body = JSON.parse(request.postData);
      const url = new URL(request.url);
      writes.push({ path: url.pathname, body });
      let response = { success: true, exceptionId: body.status === 'Available' ? null : 'demoExNew' };
      if (url.pathname.endsWith('/api/set-my-availability-for-date')) response = { success: true, updated: 2, results: [{ matchId: 'demoM1', exceptionId: 'demoDay1' }, { matchId: 'demoM8', exceptionId: 'demoDay8' }] };
      if (url.pathname.endsWith('/api/my-availability-rules')) response = { ...body, id: 'demoRuleNew', active: true };
      const failed = failNext;
      failNext = false;
      await page.send('Fetch.fulfillRequest', {
        requestId, responseCode: failed ? 500 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(failed ? { error: 'DEMO_SAVE_FAILED', message: 'Test save failure' } : response)).toString('base64'),
      });
    })().catch((err) => problems.push(String(err)));
  });
  await page.send('Fetch.enable', { patterns: [
    { urlPattern: '*/demo-api/api/set-my-availability*', requestStage: 'Request' },
    { urlPattern: '*/demo-api/api/my-availability-rules', requestStage: 'Request' },
    { urlPattern: '*/demo-api/api/match/*/availability', requestStage: 'Request' },
    { urlPattern: '*/demo-api/api/my-fixtures*', requestStage: 'Response' },
  ] });
  const goto = (url) => page.goto(`http://127.0.0.1:5201${url}`);
  const text = () => page.eval('return document.body.innerText');
  const card = (opponent) => `[...document.querySelectorAll('[role=button]')].find((el) => el.innerText.includes(${JSON.stringify(opponent)}))`;
  const tap = async (opponent, label) => {
    await page.eval(`[...${card(opponent)}.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(label)}).click()`);
    assert.equal(await page.settle(), true);
  };
  const answer = (opponent) => page.eval(`return ${card(opponent)}.querySelector('button[aria-pressed=true]')?.innerText`);
  const fill = async (note) => {
    await page.eval(`const el = document.querySelector('[role=dialog] textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(note)}); el.dispatchEvent(new Event('input', { bubbles: true }));`);
    await page.sleep(100);
  };
  const saveDisabled = () => page.eval(`return [...document.querySelectorAll('[role=dialog] button')].find((b) => /^(Save answer|Save)$/.test(b.innerText.trim()))?.disabled`);

  await goto('/coach/match/demoM1-home?as=coach');
  await page.click('Set availability for Noah Singh');
  assert.equal(await page.settle(), true);
  assert.match(await text(), /Season attendance and availability/);
  assert.ok(await page.eval('return !!document.querySelector(\'section[aria-label="Season attendance and availability"] table tbody button\')'));
  const readsBefore = attendanceReads;
  await page.click('Available', { selector: '[role=dialog] button', exact: true });
  await page.click('Save for Noah Singh');
  assert.equal(await page.settle(), true);
  assert.ok(attendanceReads > readsBefore, 'saving refreshes the attendance query');
  await page.click('Set availability for Noah Singh');
  assert.equal(await page.settle(), true);
  for (const width of [320, 390, 1024]) {
    await page.setViewport(width, 844, 1);
    assert.equal(await page.eval(`const el = document.querySelector('[role=dialog]'); return el.scrollWidth > el.clientWidth`), false, `coach sheet overflow at ${width}px`);
  }
  await page.setViewport(390, 844, 1);
  await page.eval(`document.querySelector('section[aria-label="Season attendance and availability"]').scrollIntoView({ block: 'center' })`);
  await page.screenshot(path.join(out, 'coach-attendance-mobile.png'));
  console.log('ok   Coach availability includes the season grid and refreshes it after a save');

  await goto('/?as=player');
  const baseline = writes.length;
  await tap('Valley B', 'Maybe');
  assert.equal(writes.length, baseline, 'tapping Maybe must not write before collecting a note');
  assert.equal(await saveDisabled(), true);
  await fill(' \n\t ');
  assert.equal(await saveDisabled(), true);
  await page.click('Cancel', { selector: '[role=dialog] button', exact: true });
  assert.equal(await answer('Valley B'), 'Going');
  assert.equal(writes.length, baseline);
  console.log('ok   Empty and whitespace-only Maybe drafts cannot save; Cancel preserves the answer');

  await tap('Valley B', 'No');
  assert.equal(writes.length, baseline);
  assert.equal(await saveDisabled(), true);
  await fill('  Away that weekend  ');
  await page.screenshot(path.join(out, 'required-note-mobile.png'));
  failNext = true;
  await page.click('Save answer', { exact: true });
  assert.equal(await page.settle(), true);
  assert.equal(await answer('Valley B'), 'Going');
  assert.equal(await page.eval('return document.querySelector("[role=dialog] textarea")?.value'), '  Away that weekend  ');
  await page.click('Save answer', { exact: true });
  assert.equal(await page.settle(), true);
  assert.equal(await answer('Valley B'), 'No');
  assert.deepEqual(writes.at(-1).body, { matchId: 'demoM1', status: 'Unavailable', notes: 'Away that weekend' });
  assert.equal(await page.eval('return !!document.querySelector("[role=dialog]")'), false);
  console.log('ok   Failed saves keep the draft for retry; success sends status and trimmed note together');

  const beforePrompt = writes.length;
  await page.eval(`const el = document.querySelector('select[aria-label="Availability for HKFC D vs Valley D"]'); el.value = 'Maybe'; el.dispatchEvent(new Event('change', { bubbles: true }));`);
  assert.equal(await page.settle(), true);
  assert.equal(writes.length, beforePrompt);
  assert.equal(await saveDisabled(), true);
  await fill('Training, will confirm Friday');
  await page.click('Save answer', { exact: true });
  assert.equal(await page.settle(), true);
  assert.deepEqual(writes.at(-1).body, { matchId: 'demoM8', status: 'Maybe', notes: 'Training, will confirm Friday' });
  console.log('ok   Same-day per-game choices also require an explanation');

  const beforeDay = writes.length;
  await page.click('Out all day', { exact: true });
  assert.equal(await page.settle(), true);
  assert.match(await text(), /All HKFC fixtures/);
  assert.equal(writes.length, beforeDay);
  await fill('');
  assert.equal(await saveDisabled(), true);
  await fill('Away all day');
  await page.click('Save answer', { exact: true });
  assert.equal(await page.settle(), true);
  assert.equal(writes.at(-1).body.notes, 'Away all day');
  assert.ok(writes.at(-1).path.endsWith('/api/set-my-availability-for-date'));
  await page.click('Support fixtures', { exact: false });
  assert.equal(await answer('Valley D'), 'No');
  assert.match(await page.eval(`return ${card('Valley D')}.innerText`), /Away all day/);
  console.log('ok   Out all day requires a note and shows it on affected fixture cards');

  await tap('Valley B', 'Going'); // Still selected: the Available button says Going.
  assert.equal(writes.at(-1).body.status, 'Available');
  assert.equal(await answer('Valley B'), 'Going');
  console.log('ok   Available still saves directly without a note');

  await goto('/?as=player&preferences=1');
  await page.click('Add a preference');
  assert.equal(await saveDisabled(), true);
  await fill('  Work commitments, confirm Friday  ');
  await page.click('Save', { selector: '[role=dialog] button', exact: true });
  assert.equal(await page.settle(), true);
  assert.ok(writes.at(-1).path.endsWith('/api/my-availability-rules'));
  assert.equal(writes.at(-1).body.notes, 'Work commitments, confirm Friday');
  console.log('ok   Availability preferences require and submit the note too');

  keeper = true;
  await goto('/?as=player');
  await page.click('Set whole day');
  const beforeKeeper = writes.length;
  await page.click('All maybe');
  assert.equal(await page.settle(), true);
  assert.equal(writes.length, beforeKeeper);
  assert.equal(await saveDisabled(), true);
  await fill('Work, will confirm Thursday');
  await page.click('Save answer', { exact: true });
  assert.equal(await page.settle(), true);
  assert.equal(writes.at(-1).body.status, 'Maybe');
  assert.equal(writes.at(-1).body.notes, 'Work, will confirm Thursday');
  assert.ok(writes.at(-1).path.endsWith('/api/set-my-availability-for-date'));
  console.log('ok   Goalkeeper whole-day Maybe uses the same required-note flow');

  assert.deepEqual(problems, []);
  await page.close();
  console.log('8/8 availability browser scenarios passed; all writes used fictional responses.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
