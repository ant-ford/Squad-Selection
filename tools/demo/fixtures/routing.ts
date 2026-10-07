// The routing types and reply(), apart from index.ts so that the area files
// don't import index.ts (which imports them): that loop let a request see a
// half-loaded index.
import type { Persona } from '../personas.mjs';

export interface DemoRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  /** The `?as=` persona the tab signed in as. */
  as: string;
  persona: Persona;
  params: Record<string, string>;
  body: any;
}

export type Handler = (req: DemoRequest) => unknown;
export type Routes = Record<string, Handler>;

export interface Reply {
  status: number;
  body: unknown;
  contentType?: string;
  missing?: boolean;
}

export const REPLY = Symbol('reply');
/** An error (or any non-200) answer: `return reply(409, { error: 'CHANGED', message: '…' })`. */
export function reply(status: number, body: unknown, contentType?: string) {
  return { [REPLY]: true, status, body, contentType };
}

