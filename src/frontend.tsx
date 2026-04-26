/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { unlockAudio } from "./lib/audio";

// Unlock iOS audio on the very first user gesture so the PM agent's
// first_message plays immediately on iPad. Without this, the gesture
// from tapping the mic button "expires" before the SDK's first audio
// frame arrives and iOS silently mutes playback. See lib/audio.ts.
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", unlockAudio, { once: true });
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
