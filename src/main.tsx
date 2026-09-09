import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import App from "./App";
import "./index.css";
import { recoverFromStaleDeploy, isChunkLoadError } from './lib/staleDeploy';

// A chunk that fails to load almost always means this client is holding an
// index.html from a previous deploy. Reloading on its own does not help: the
// service worker precache answers the next load identically. recoverFromStaleDeploy
// drops the worker and its caches first, and only ever runs once per tab.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  void recoverFromStaleDeploy();
});

// The preload event does not fire when the chunk request itself succeeds and
// returns HTML, which is exactly what the SPA fallback does for a filename
// that no longer exists. That surfaces as a rejected dynamic import instead.
window.addEventListener('unhandledrejection', (event) => {
  if (isChunkLoadError(event.reason)) void recoverFromStaleDeploy();
});

ReactDOM.createRoot(
  document.getElementById("root")!
).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);