/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SPEECH_ABORT_REASON } from "./lib/tts";
import { isAbortError } from "./lib/utils";

// Some browser extensions (translation tools, etc.) monkey-patch
// `window.fetch` and re-throw its AbortError on a separate promise we
// can't catch from inside `lib/tts.ts`. Suppress that exact reason —
// anything else still surfaces. Guarded so HMR re-imports don't keep
// stacking new listeners across the dev session.
type WindowWithFlag = Window & { __mochiSpeechAbortHandler?: true };
if (typeof window !== "undefined") {
  const w = window as WindowWithFlag;
  if (!w.__mochiSpeechAbortHandler) {
    w.__mochiSpeechAbortHandler = true;
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      if (isAbortError(reason) && reason.message === SPEECH_ABORT_REASON) {
        event.preventDefault();
      }
    });
  }
}

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

if (import.meta.hot) {
  // With hot module reloading, `import.meta.hot.data` is persisted.
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  // The hot module reloading API is not available in production.
  createRoot(elem).render(app);
}

// PWA: inject the manifest + apple-touch-icon at runtime. We can't put
// them in index.html directly because Bun's HTML bundler tries to resolve
// the hrefs as build-time assets and chokes on absolute paths.
function ensureLink(rel: string, href: string) {
  if (document.querySelector(`link[rel="${rel}"][href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
}
ensureLink("manifest", "/manifest.webmanifest");
ensureLink("apple-touch-icon", "/icons/apple-touch-icon.png");

// Register the service worker once the page is idle. Skip on insecure
// origins (real browsers gate SW on HTTPS/localhost) — registration
// would just throw and the install prompt depends on a secure context
// anyway. iOS Add-to-Home-Screen still works without an SW.
if (
  "serviceWorker" in navigator &&
  (location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
