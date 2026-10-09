import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient, restorePersistedQueries } from './lib/queryClient';
import App from "./App";
import "./index.css";
import { installChunkRecovery } from './lib/chunkRecovery';
import { installClientErrorReporting, reportUnrecoveredScreenLoad } from './lib/clientErrors';

// Crashes go to the Worker's error_log, for /system.
installClientErrorReporting();

// A chunk that fails to load almost always means this client is holding an
// index.html from a previous deploy. recoverFromStaleDeploy reloads, and if
// the same thing happens again drops the service worker and its caches before
// reloading; it never goes further than that in one tab.
installChunkRecovery(reportUnrecoveredScreenLoad);

// The person's own fixtures, profile and tasks from their last visit go into
// the cache first (at most 200 ms, behind the boot loader), so the player page
// opens on them and refreshes behind.
void restorePersistedQueries(200).then(() => {
  ReactDOM.createRoot(
    document.getElementById("root")!
  ).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  );
});
