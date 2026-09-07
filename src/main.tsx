import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import App from "./App";
import "./index.css";

window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('vite-reload-once')) return;
  sessionStorage.setItem('vite-reload-once', '1');
  window.location.reload();
});
window.addEventListener('load', () => {
  setTimeout(() => sessionStorage.removeItem('vite-reload-once'), 10_000);
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