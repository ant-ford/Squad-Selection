// A small Chrome DevTools Protocol driver over Node's built-in WebSocket:
// headless Chrome or Edge, no npm packages. Used by smoke.mjs and the guide
// screenshot scripts in shots/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CHROME_PATH, else the usual Chrome or Edge install for this platform. */
export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chrome or Edge found: set CHROME_PATH.');
  return found;
}

/**
 * Starts a headless browser. Returns { newPage, close }.
 * @param {{ port?: number }} [options]
 */
export async function launchBrowser({ port = 9333 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'eddy-cdp-'));
  const args = [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb',
    '--disable-extensions', '--disable-background-networking', '--disable-gpu', '--lang=en-GB',
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    'about:blank',
  ];
  const proc = spawn(findBrowser(), args, { stdio: 'ignore' });
  let version;
  for (let i = 0; i < 75 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
  if (!version) throw new Error('The browser did not start.');
  const browser = await connect(version.webSocketDebuggerUrl);

  return {
    /** A new tab with its own CDP session. */
    async newPage({ width = 390, height = 844, scale = 2 } = {}) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const { webSocketDebuggerUrl } = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.id === targetId);
      const conn = await connect(webSocketDebuggerUrl);
      return makePage(conn, { width, height, scale, close: () => browser.send('Target.closeTarget', { targetId }).catch(() => {}) });
    },
    async close() {
      await browser.send('Browser.close').catch(() => {});
      proc.kill();
      await sleep(300);
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
      } catch {
        // Windows can hold the profile a little longer; it's in the temp folder.
      }
    },
  };
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, { resolve, reject });
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
    on: (fn) => listeners.add(fn),
    off: (fn) => listeners.delete(fn),
    close: () => ws.close(),
  };
}

async function makePage(conn, { width, height, scale, close }) {
  const { send } = conn;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: width < 768 });

  // Requests still in flight, so settle() can wait for the slow ones too.
  const inflight = new Set();
  conn.on((msg) => {
    if (msg.method === 'Network.requestWillBeSent' && msg.params.type !== 'WebSocket') inflight.add(msg.params.requestId);
    else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') inflight.delete(msg.params.requestId);
    else if (msg.method === 'Page.frameStartedLoading') inflight.clear();
  });

  const page = {
    send,
    on: conn.on,
    off: conn.off,
    sleep,
    async setViewport(w, h, s = scale) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: s, mobile: w < 768 });
    },
    /** Runs `body` (the inside of an async function) in the page and returns its result. */
    async eval(body) {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    /** Opens a URL and waits for the screen to settle (see settle). */
    async goto(url, { settleMs = 400, timeoutMs = 30_000 } = {}) {
      await send('Page.navigate', { url });
      await page.settle({ quietMs: settleMs, timeoutMs });
    },
    /**
     * Waits until the app has mounted, no loading skeleton shows and no
     * request is in flight, and stays so for `quietMs`.
     */
    async settle({ quietMs = 400, timeoutMs = 30_000 } = {}) {
      const until = Date.now() + timeoutMs;
      let quietSince = 0;
      while (Date.now() < until) {
        await sleep(100);
        let state;
        try {
          state = await page.eval(`
            const root = document.getElementById('root');
            const mounted = !!root && root.children.length > 0 && !document.getElementById('boot-loader');
            // A skeleton, or the app's loading screen (the hopping ball).
            const loading = !!document.querySelector('#root .animate-pulse, #root [class*="ball-hop"]');
            return { mounted, loading };`);
        } catch {
          quietSince = 0;
          continue;
        }
        if (!state.mounted || state.loading || inflight.size > 0) {
          quietSince = 0;
          continue;
        }
        if (!quietSince) quietSince = Date.now();
        if (Date.now() - quietSince >= quietMs) return true;
      }
      return false;
    },
    /** Clicks the first visible element whose text or aria-label contains `text`. */
    async click(text, { selector = 'button,a,[role=button],[role=tab],[role=menuitem],label,summary', exact = false, nth = 0, wait = 500 } = {}) {
      const ok = await page.eval(`
        const want = ${JSON.stringify(text)}.toLowerCase();
        let els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => {
          const t = (el.innerText || '').trim().toLowerCase();
          const a = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
          if (!el.getClientRects().length) return false;
          return ${exact} ? t === want || a === want : t.includes(want) || a.includes(want);
        });
        els = els.filter((e) => !els.some((o) => o !== e && e.contains(o)));
        const el = els[${nth}];
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;`);
      if (!ok) throw new Error(`click: nothing matches "${text}"`);
      await sleep(wait);
    },
    /** A PNG of the viewport, or of `clip` ({ x, y, width, height } in CSS px). */
    async screenshot(file, clip) {
      const params = { format: 'png' };
      if (clip) Object.assign(params, { clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
      const { data } = await send('Page.captureScreenshot', params);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
    /** A PNG of the page's full height at the current width. */
    async fullPage(file) {
      const h = await page.eval('return Math.ceil(document.documentElement.scrollHeight)');
      const w = await page.eval('return document.documentElement.clientWidth');
      await page.screenshot(file, { x: 0, y: 0, width: w, height: h });
    },
    /**
     * A PNG of the element(s) a page expression returns (their union, padded),
     * scrolled into view first.
     */
    async element(file, expr, pad = 12) {
      const r = await page.eval(`
        const els = [].concat(${expr}).filter(Boolean);
        if (!els.length) throw new Error('element: nothing matches');
        els[0].scrollIntoView({ block: 'center' });
        await new Promise((r) => setTimeout(r, 250));
        const rs = els.map((e) => e.getBoundingClientRect());
        const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
        const x2 = Math.max(...rs.map((r) => r.right)), y2 = Math.max(...rs.map((r) => r.bottom));
        return { x: x + scrollX, y: y + scrollY, w: x2 - x, h: y2 - y, vw: document.documentElement.clientWidth };`);
      const x = Math.max(0, r.x - pad);
      const y = Math.max(0, r.y - pad);
      await page.screenshot(file, { x, y, width: Math.min(r.vw - x, r.w + pad * 2), height: r.h + pad * 2 });
    },
    /** Opens a header drop-down menu by its label (Radix opens on pointerdown, not click). */
    async openMenu(label, wait = 400) {
      await page.eval(`
        const b = document.querySelector('[aria-label=${JSON.stringify(label)}]');
        if (!b) throw new Error('openMenu: no ' + ${JSON.stringify(label)});
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));`);
      await sleep(wait);
    },
    /** Re-encodes a PNG file as WebP (quality 0-1) in the browser, and deletes the PNG. */
    async toWebp(pngFile, quality = 0.86) {
      const b64 = fs.readFileSync(pngFile).toString('base64');
      const url = await page.eval(`
        const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL('image/webp', ${quality});`);
      const out = pngFile.replace(/\.png$/, '.webp');
      fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
      fs.unlinkSync(pngFile);
      return out;
    },
    async close() {
      conn.close();
      await close();
    },
  };
  return page;
}
