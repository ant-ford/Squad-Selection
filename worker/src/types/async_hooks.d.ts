/**
 * The slice of Node's AsyncLocalStorage the Worker uses for per-request
 * context (see requestContext.ts).
 *
 * Declared here because the Worker compiles against
 * @cloudflare/workers-types only - pulling in @types/node alongside it
 * redeclares fetch, Request and Response and the two disagree. Cloudflare
 * provides the real implementation under the `nodejs_als` compatibility
 * flag (worker/wrangler.toml); Vitest resolves it to Node's own module.
 */
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;
    getStore(): T | undefined;
  }
}
