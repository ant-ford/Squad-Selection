// Answers the app's API calls from fictional data. plugin.mjs loads this
// through Vite on every request, so an edit here shows on the next request.
//
// Each area's file exports `routes`: 'METHOD /api/path/:param' -> handler.
// A handler returns the response body (typed against the app's own API
// types in src/api, so `tsc -p tools/demo` fails when a shape changes), or
// `reply(status, body)` for an error. A request with no route is a 404 that
// the smoke test fails on.
import { PERSONAS } from '../personas.mjs';
import { routes as player } from './player';
import { routes as coach } from './coach';
import { routes as officers } from './officers';
import { routes as people } from './people';
import { routes as kit } from './kit';
import { routes as events } from './events';
import { routes as umpiring } from './umpiring';
import { routes as stats } from './stats';
import { REPLY, type Reply, type Routes } from './routing';

export { reply, type DemoRequest, type Handler, type Routes } from './routing';

const ALL: Routes = {};
for (const area of [player, coach, officers, people, kit, events, umpiring, stats]) {
  for (const [key, handler] of Object.entries(area)) {
    if (key in ALL) throw new Error(`demo fixtures: two files answer ${key}`);
    ALL[key] = handler;
  }
}

const compiled = Object.entries(ALL).map(([key, handler]) => {
  const [method, pattern] = key.split(' ');
  const names: string[] = [];
  const re = new RegExp(
    '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\?:([A-Za-z]+)/g, (_m, name) => (names.push(name), '([^/]+)')) + '$',
  );
  return { method, re, names, handler };
});

export async function answer(r: { method: string; path: string; query: URLSearchParams; persona: string | null; body: unknown }): Promise<Reply> {
  const persona = r.persona ? PERSONAS[r.persona] : undefined;
  if (!persona) return { status: 401, body: { error: 'UNAUTHORIZED', message: 'Not signed in (demo).' } };
  for (const route of compiled) {
    if (route.method !== r.method) continue;
    const m = route.re.exec(r.path);
    if (!m) continue;
    const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const out = await route.handler({ method: r.method, path: r.path, query: r.query, as: r.persona!, persona, params, body: r.body });
    if (out === undefined) break;
    if (out && typeof out === 'object' && REPLY in out) {
      const o = out as unknown as Reply;
      return { status: o.status, body: o.body, contentType: o.contentType };
    }
    return { status: 200, body: out };
  }
  return { status: 404, missing: true, body: { error: 'NOT_FOUND', message: `demo: no fixture for ${r.method} ${r.path}` } };
}
