/**
 * Which built files the service worker precaches (vite.config.ts).
 *
 * Only sign-in and Player view are precached: the entry chunk and everything
 * it loads, plus the lazy pieces a player can open from their page (sheets,
 * menus, dialogs). Officer and coach screens are lazy routes in src/App.tsx;
 * they are cached the first time someone opens them, not on every phone.
 *
 * The walk is over chunks, following what each one really imports after
 * tree-shaking. (A walk over modules would follow every re-export of a barrel
 * file such as lucide-react's, and so reach icons that only officer screens
 * use.) Dynamic imports are attributed to the module that issues them: every
 * import() in the route table is a screen left out, while an import()
 * anywhere else in what is precached (a sheet opened from the player page,
 * the dialog library) is a piece the player view needs.
 */

/** One JS chunk of the Rollup bundle, reduced to what the walk needs. */
export interface PrecacheChunk {
  fileName: string;
  isEntry: boolean;
  /** Modules bundled into this chunk. */
  moduleIds: readonly string[];
  /** Chunks this one imports statically (file names); they load with it. */
  imports: readonly string[];
  /** CSS files this chunk pulls in (Vite's viteMetadata.importedCss). */
  css: readonly string[];
}

export interface PrecacheGraph {
  chunks: readonly PrecacheChunk[];
  /** Module ids each module loads with import(); modules with none can be left out. */
  dynamicImports: ReadonlyMap<string, readonly string[]>;
}

export interface PrecacheRules {
  /** Modules the player view starts from, whether App.tsx imports them statically or lazily. */
  roots: readonly string[];
  /** The route table: import() calls issued from this module are not followed. */
  routeTable: string;
}

/**
 * File names (JS and CSS) to precache. Throws rather than return a set that
 * would leave the app shell out, or quietly miss a root that was renamed.
 */
export function precacheSet(graph: PrecacheGraph, rules: PrecacheRules): Set<string> {
  const entries = graph.chunks.filter((c) => c.isEntry);
  if (entries.length !== 1) {
    throw new Error(`precache: expected one entry chunk, found ${entries.length}`);
  }
  const entry = entries[0];

  const chunkOfModule = new Map<string, PrecacheChunk>();
  for (const chunk of graph.chunks) {
    for (const id of chunk.moduleIds) chunkOfModule.set(id, chunk);
  }
  const chunkByFile = new Map(graph.chunks.map((c) => [c.fileName, c]));

  const queue: PrecacheChunk[] = [entry];
  for (const root of rules.roots) {
    const chunk = chunkOfModule.get(root);
    if (!chunk) throw new Error(`precache: player-view module ${root} is not in the bundle`);
    queue.push(chunk);
  }

  const files = new Set<string>();
  while (queue.length > 0) {
    const chunk = queue.pop()!;
    if (files.has(chunk.fileName)) continue;
    files.add(chunk.fileName);
    for (const css of chunk.css) files.add(css);
    for (const file of chunk.imports) {
      const imported = chunkByFile.get(file);
      if (imported) queue.push(imported);
    }
    for (const id of chunk.moduleIds) {
      if (id === rules.routeTable) continue;
      for (const target of graph.dynamicImports.get(id) ?? []) {
        const loaded = chunkOfModule.get(target);
        if (loaded) queue.push(loaded);
      }
    }
  }

  return files;
}

/** Built JS and CSS: the only files the set decides on. */
const BUNDLE_FILE = /^assets\/.+\.(?:js|css)$/;

/**
 * Keeps a precache manifest entry when it is in the set, or is not a bundle
 * file at all (index.html, registerSW.js, the manifest, icons, the font).
 * Throws if there is no set, or the entry chunk is not among what is kept.
 */
export function filterPrecacheManifest<T extends { url: string }>(
  manifest: readonly T[],
  keep: ReadonlySet<string> | undefined,
  entryFile: string | undefined,
): T[] {
  if (!keep || keep.size === 0 || !entryFile) {
    throw new Error("precache: no player-view set was worked out for this build");
  }
  const kept = manifest.filter((e) => !BUNDLE_FILE.test(e.url) || keep.has(e.url));
  if (!kept.some((e) => e.url === entryFile)) {
    throw new Error(`precache: the entry chunk ${entryFile} is not in the precache manifest`);
  }
  return kept;
}
