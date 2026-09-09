/**
 * Front door for the static frontend Worker.
 *
 * Static assets are matched and served before this script runs, so it only
 * ever sees a request that did NOT match a file in dist/. There are two very
 * different reasons for that, and the previous configuration answered both
 * the same way.
 *
 * `not_found_handling: "single-page-application"` returned index.html, with
 * status 200, for every miss - including a request for a hashed build file.
 * Asset filenames are content-hashed and a deploy removes the previous ones,
 * so a client still holding an old page asks for chunk names that no longer
 * exist. It was handed HTML, tried to parse it as a JavaScript module, and the
 * lazy route never resolved: the loading skeleton stayed on screen for good,
 * with no error anyone could act on.
 *
 * Splitting the two cases is the whole point of this script:
 *
 *   /assets/<hashed file>   a real miss. 404, so the browser reports a failed
 *                           import the app can catch and recover from.
 *   anything else           a client-side route. Serve the app shell.
 */

interface Env {
  ASSETS: Fetcher;
}

/** Build output. Everything here is content-hashed and immutable. */
const BUILD_OUTPUT_PREFIX = "/assets/";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith(BUILD_OUTPUT_PREFIX)) {
      return new Response("Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          // Never let a negative answer stick: the next deploy may well
          // create a file at this path, and a cached 404 would outlive it.
          "Cache-Control": "no-store",
        },
      });
    }

    // A client-side route (/coach, /coach/ranking, a deep link someone
    // bookmarked). Hand back the app shell and let the router take over.
    // Requested by path rather than by rewriting the incoming request so the
    // response is index.html itself, headers and all.
    return env.ASSETS.fetch(new Request(new URL("/index.html", url.origin), request));
  },
};
