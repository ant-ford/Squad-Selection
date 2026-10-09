// Exercise fixture counts and cross-squad details on fictional demo data.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { launchBrowser } from './cdp.mjs';
import { startDemoServer } from './server.mjs';

const { values } = parseArgs({ options: { out: { type: 'string', default: path.join(os.tmpdir(), 'eddy-team-availability') } } });
const out = path.resolve(values.out);
const server = await startDemoServer({ port: 5195, quiet: true });
let browser;
try {
  browser = await launchBrowser({ port: 9338 });
  const page = await browser.newPage({ scale: 1 });
  const problems = [];
  page.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') problems.push('Uncaught browser exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push('Browser console error');
  });
  await page.goto('http://127.0.0.1:5195/coach/availability?as=coach');
  const data = await page.eval("return await (await fetch('/demo-api/api/team-attendance', { headers: { Authorization: 'Bearer demo.coach' } })).json()");
  const upcoming = data.fixtures.find((f) => f.team === 'HKFC C' && !f.past && f.selectedCount > 0);
  const past = data.fixtures.find((f) => f.team === 'HKFC C' && f.past);
  const empty = data.fixtures.find((f) => f.team === 'HKFC C' && !f.past && f.selectedCount === 0);
  assert.ok(upcoming && past && empty, 'demo must include upcoming, past and zero-selection fixtures');
  const cellLabel = (f) => `${f.team} vs ${f.opponent},`;
  const badge = async (f) => page.eval(`
    const cell = [...document.querySelectorAll('table button[aria-label]')].find((el) => el.getAttribute('aria-label').startsWith(${JSON.stringify(cellLabel(f))}));
    const badge = cell.querySelector('span[aria-label]');
    if (!badge) return null;
    const style = getComputedStyle(badge);
    return { text: badge.textContent.trim(), label: badge.getAttribute('aria-label'), font: style.fontSize, background: style.backgroundColor };
  `);
  const selected = await badge(upcoming);
  const played = await badge(past);
  assert.equal(selected.text, String(upcoming.selectedCount));
  assert.equal(selected.label, `${upcoming.selectedCount} selected`);
  assert.equal(selected.font, '10px');
  assert.equal(played.text, String(past.cardCount));
  assert.equal(played.font, '10px');
  assert.notEqual(selected.background, played.background);
  assert.equal(await badge(empty), null);
  console.log('ok   smaller badges distinguish selected counts from match-card counts and hide zero selections');

  const text = () => page.eval('return document.body.innerText');
  await page.click(cellLabel(upcoming));
  assert.match(await text(), /Selected from other squads/);
  for (const p of upcoming.otherPlayers) assert.ok((await text()).includes(`${p.name} · ${p.team}`));
  console.log('ok   upcoming fixture details include selected guests and their squad teams');
  await page.fullPage(path.join(out, 'upcoming-mobile.png'));

  await page.click(cellLabel(past));
  assert.match(await text(), /Played from other squads/);
  for (const p of past.otherPlayers) assert.ok((await text()).includes(`${p.name} · ${p.team}`));
  assert.doesNotMatch(await text(), /Selected from other squads/);
  console.log('ok   past fixture details include match-card guests and their squad teams');

  for (const width of [320, 390, 1024]) {
    await page.setViewport(width, 844, 1);
    assert.equal(await page.eval('return document.documentElement.scrollWidth > innerWidth'), false, `page overflow at ${width}px`);
  }
  await page.fullPage(path.join(out, 'past-desktop.png'));
  assert.deepEqual(problems, []);
  console.log('ok   details fit mobile and desktop without page overflow or browser errors');
  await page.close();
  console.log('4/4 Team availability browser scenarios passed.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
