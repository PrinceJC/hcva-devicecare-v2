import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { configurationError } from "./lib/supabase.js";
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {configurationError ? (
      <main className="config-screen">
        <h1>DeviceCare needs configuration</h1>
        <p>{configurationError}</p>
        <p>
          For local development, update <code>.env.local</code> and restart
          Vite. For Vercel, save the variables in the project settings and
          redeploy.
        </p>
      </main>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
