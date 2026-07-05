import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,  // keep in memory for 30 mins
      retry: 1,
      refetchOnWindowFocus: false, // prevents re-fetches when coaches switch tabs
    },
  },
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