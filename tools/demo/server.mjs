// Starts the real Eddy frontend (Vite dev server, the repo's vite.config.ts)
// against the demo fixtures. Used by serve.mjs (by hand) and smoke.mjs (CI).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoPlugin, API_PREFIX } from './plugin.mjs';

/**
 * The repository root, by its long name. On Windows a short 8.3 name
 * (ANTHON~1.FOR) in a watched path crashes Vite's file watcher.
 */
export const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')).replace(/\\/g, '/');

/** @param {{ port?: number, log?: (line: string) => void, quiet?: boolean }} [options] */
export async function startDemoServer({ port = 5190, log, quiet = false } = {}) {
  // Values already in the environment win over every .env file, so a local
  // .env can't point the demo at a real API.
  process.env.VITE_API_URL = API_PREFIX;
  process.env.VITE_SUPABASE_URL = 'https://demo.invalid';
  process.env.VITE_SUPABASE_ANON_KEY = 'demo';
  process.env.VITE_TURNSTILE_SITE_KEY = '';
  // Tailwind finds the class names to generate by scanning from the cwd.
  process.chdir(ROOT);
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT,
    configFile: `${ROOT}/vite.config.ts`,
    mode: 'demo',
    logLevel: quiet ? 'warn' : 'info',
    plugins: [demoPlugin({ log })],
    // node_modules may be a link to another checkout (a git worktree's junction).
    server: { port, strictPort: true, host: '127.0.0.1', fs: { allow: [ROOT, fs.realpathSync.native(`${ROOT}/node_modules`)] } },
  });
  await server.listen();
  return server;
}
