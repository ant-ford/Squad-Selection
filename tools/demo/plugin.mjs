// The Vite plugin behind the demo harness (see README.md here).
//  - Swaps src/lib/supabase.ts for fakeSupabase.ts: always signed in, as a persona.
//  - Answers /demo-api/* from the fixtures in fixtures/, loaded through Vite,
//    so editing a fixture takes effect on the next request (no restart).
// A request no fixture answers gets a 404 with the X-Demo-Missing header and a
// "MISSING" line in the server log; the smoke test fails on it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const FAKE_SUPABASE = `${HERE}/fakeSupabase.ts`;
const FIXTURES = `${HERE}/fixtures/index.ts`;
export const API_PREFIX = '/demo-api';

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** @param {{ log?: (line: string) => void }} [options] */
export function demoPlugin({ log = (line) => console.log(line) } = {}) {
  return {
    name: 'eddy-demo',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null;
      const fromLib = /[\\/]src[\\/]lib[\\/]/.test(importer);
      if ((fromLib && source === './supabase') || source === '@/lib/supabase') return FAKE_SUPABASE;
      return null;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith(`${API_PREFIX}/`)) return next();
        const apiPath = url.pathname.slice(API_PREFIX.length);
        const method = req.method ?? 'GET';
        const auth = req.headers.authorization ?? '';
        const persona = auth.startsWith('Bearer demo.') ? auth.slice('Bearer demo.'.length) : null;
        try {
          const { answer } = await server.ssrLoadModule(FIXTURES);
          const body = method === 'GET' ? undefined : await readBody(req);
          const reply = await answer({ method, path: apiPath, query: url.searchParams, persona, body });
          res.setHeader('Content-Type', reply.contentType ?? 'application/json');
          if (reply.missing) {
            res.setHeader('X-Demo-Missing', '1');
            log(`MISSING ${method} ${apiPath} (${persona ?? 'signed out'})`);
          }
          res.statusCode = reply.status;
          res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
        } catch (err) {
          log(`FIXTURE ERROR ${method} ${apiPath}: ${err?.stack ?? err}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Demo-Missing', '1');
          res.end(JSON.stringify({ error: 'DEMO_FIXTURE_ERROR', message: String(err?.message ?? err) }));
        }
      });
    },
  };
}
