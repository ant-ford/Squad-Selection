// Production Vite + React, with real failed JS/CSS requests and real reloads.
// Exercises the app's recovery modules, without an API, credentials or club data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { launchBrowser } from './cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'eddy-recovery-'));
const sourcePath = (file) => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
let browser;
let server;
try {
  fs.writeFileSync(path.join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="/main.js"></script>');
  fs.writeFileSync(path.join(fixture, 'screen.js'), "import './screen.css'; export default function Screen() { return 'Screen loaded'; }");
  fs.writeFileSync(path.join(fixture, 'screen.css'), '#root { color: rgb(10, 20, 30); }');
  fs.writeFileSync(path.join(fixture, 'main.js'), `
    import React, { Component, lazy, Suspense } from 'react';
    import { createRoot } from 'react-dom/client';
    import { installChunkRecovery, recoverScreenLoad } from ${sourcePath('src/lib/chunkRecovery.ts')};
    if (new URL(location.href).searchParams.has('blocked')) {
      Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
    }
    window.reports = [];
    const report = (error) => {
      if (!window.reports.includes(String(error))) window.reports.push(String(error));
    };
    installChunkRecovery(report);
    const Screen = lazy(() => import('./screen.js'));
    class Boundary extends Component {
      state = { error: null };
      static getDerivedStateFromError(error) { return { error }; }
      componentDidCatch(error) { void recoverScreenLoad(error, report); }
      render() {
        return this.state.error
          ? React.createElement('p', { id: 'failure' }, String(this.state.error))
          : this.props.children;
      }
    }
    createRoot(document.getElementById('root')).render(
      React.createElement(Boundary, null,
        React.createElement(Suspense, { fallback: React.createElement('p', { className: 'animate-pulse' }, 'Loading') },
          React.createElement(Screen))));
  `);
  const output = path.join(fixture, 'dist');
  await build({
    root: fixture, configFile: false, logLevel: 'warn',
    resolve: { alias: {
      'react-dom/client': path.join(root, 'node_modules/react-dom/client.js'),
      react: path.join(root, 'node_modules/react/index.js'),
    } },
    build: { outDir: output, minify: true },
  });
  let mode = 'normal';
  let loads = 0;
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/setup') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<div id="root"><p>Setup</p></div>');
    }
    if (url.pathname === '/test-sw.js') {
      res.setHeader('Content-Type', 'application/javascript');
      return res.end("self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));");
    }
    if (url.pathname === '/') loads++;
    const screenJs = /\/screen-[^/]+\.js$/.test(url.pathname);
    const screenCss = url.pathname.endsWith('.css');
    if ((screenJs && ['gone', 'interrupted'].includes(mode)) ||
        (screenJs && mode === 'transient' && loads === 1) || (screenCss && mode === 'css')) {
      res.statusCode = mode === 'interrupted' ? 503 : 404;
      return res.end('Screen asset unavailable');
    }
    const file = path.join(output, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(output + path.sep) || !fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser({ port: 9336 });
  const cases = [
    { name: 'a fresh screen loads', mode: 'normal', loads: 1, success: true },
    { name: 'first reload recovers, preserving caches and service worker', mode: 'transient', loads: 2, success: true },
    { name: 'missing JS stops after two reloads and clears stale caches', mode: 'gone', loads: 3 },
    { name: 'interrupted downloads keep the original error', mode: 'interrupted', loads: 3 },
    { name: 'missing CSS keeps its original preload error', mode: 'css', loads: 3 },
    { name: 'exhausted recovery does not reload again', mode: 'gone', loads: 1, flag: 'cleared' },
    { name: 'blocked browser storage surfaces the error without looping', mode: 'gone', loads: 1, blocked: true },
  ];
  for (const test of cases) {
    const page = await browser.newPage({ scale: 1 });
    try {
      mode = test.mode;
      loads = 0;
      await page.goto(origin + '/setup');
      await page.send('Network.clearBrowserCache');
      await page.eval(`
        sessionStorage.clear();
        for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
        for (const key of await caches.keys()) await caches.delete(key);
        if (${Boolean(test.flag)}) sessionStorage.setItem('stale-deploy-recovered', ${JSON.stringify(test.flag ?? '')});
        await (await caches.open('recovery-test-marker')).put('/marker', new Response('marker'));
        await navigator.serviceWorker.register('/test-sw.js');
        await navigator.serviceWorker.ready;
      `);
      await page.goto(origin + (test.blocked ? '/?blocked' : '/'), { timeoutMs: 20_000 });
      // The error boundary can render just before a reload. Wait for the
      // final page and its reporting callback, rather than accepting that flash.
      let state;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          state = await page.eval(`
            return { text: document.getElementById('root')?.innerText,
              reports: window.reports ?? [], caches: await caches.keys(),
              workers: (await navigator.serviceWorker.getRegistrations()).length };
          `);
          if (loads === test.loads && (test.success ? state.text === 'Screen loaded' : state.reports.length > 0)) break;
        } catch { /* navigation replaced the execution context */ }
        await page.sleep(100);
      }
      assert.equal(loads, test.loads, test.name + ': reload count');
      if (test.success) {
        assert.equal(state.text, 'Screen loaded', test.name);
        assert.deepEqual(state.reports, [], 'successful recovery does not report a crash');
        assert.ok(state.caches.includes('recovery-test-marker'));
        assert.equal(state.workers, 1);
      } else {
        assert.match(state.text, test.mode === 'css' ? /Unable to preload CSS/ : /Failed to fetch dynamically imported module/);
        assert.doesNotMatch(state.text, /reading ['"]default|_result[.]default/);
        assert.equal(state.reports.length, 1, 'unrecovered failure is reported once');
        if (test.loads === 3) {
          assert.deepEqual(state.caches, []);
          assert.equal(state.workers, 0);
        }
      }
      console.log('ok   ' + test.name);
    } finally { await page.close(); }
  }
  console.log(`${cases.length}/${cases.length} production recovery scenarios passed.`);
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(fixture, { recursive: true, force: true });
}
