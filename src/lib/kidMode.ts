import * as React from "react";

const KID_KEY = "mochi:kid-mode";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  // URL opt-in (sticky once visited): /?mode=kid pins kid mode on.
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "kid") {
    try {
      window.localStorage.setItem(KID_KEY, "1");
    } catch {
      /* ignore */
    }
    return true;
  }
  try {
    return window.localStorage.getItem(KID_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Persisted kid-mode toggle. Once on, stays on across reloads and across
 * the URL — the only way out is to call `setKid(false)` (e.g. via long-press
 * on the Mochi mascot inside the kid shell).
 */
export function useKidMode(): [boolean, (next: boolean) => void] {
  const [kid, setKidState] = React.useState<boolean>(readInitial);

  const setKid = React.useCallback((next: boolean) => {
    setKidState(next);
    try {
      if (next) window.localStorage.setItem(KID_KEY, "1");
      else window.localStorage.removeItem(KID_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return [kid, setKid];
}
