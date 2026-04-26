/**
 * Arrow-key spatial focus for TV remotes.
 *
 * Android TV remotes send ArrowUp/Down/Left/Right; WebView's default
 * is to scroll the page, not move focus, which leaves the kid stuck on
 * whichever header button got auto-focused on load. This installs a
 * keydown listener that finds the visually-closest focusable element
 * in the pressed direction (rect-center distance, with a penalty on
 * the cross axis so "down" prefers things actually below over things
 * across-and-slightly-down) and focuses it.
 *
 * Skips the nav when the active element is a text input — arrow keys
 * there should move the caret, not the focus. Skips when the active
 * element is in an iframe (we can't see into the iframe and shouldn't
 * try to escape it from the parent's keydown).
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type Dir = "up" | "down" | "left" | "right";

function visibleFocusables(): HTMLElement[] {
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  const out: HTMLElement[] = [];
  for (const el of all) {
    // offsetParent === null for display:none / hidden ancestors. Doesn't
    // catch visibility:hidden but those are rare in this app.
    if (el.offsetParent === null && el.tagName !== "BODY") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push(el);
  }
  return out;
}

/**
 * Distance from `from` to `to` in direction `dir`. Returns null if `to`
 * is not in the right half-plane. Lower is closer; primary-axis distance
 * dominates with a 1.5× penalty on cross-axis drift so "down from a
 * header button" prefers an element directly below over one offset to
 * the side.
 */
function directedDistance(
  from: DOMRect,
  to: DOMRect,
  dir: Dir,
): number | null {
  const fromCx = from.left + from.width / 2;
  const fromCy = from.top + from.height / 2;
  const toCx = to.left + to.width / 2;
  const toCy = to.top + to.height / 2;
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;

  if (dir === "down" && dy <= 0) return null;
  if (dir === "up" && dy >= 0) return null;
  if (dir === "right" && dx <= 0) return null;
  if (dir === "left" && dx >= 0) return null;

  const primary = dir === "up" || dir === "down" ? Math.abs(dy) : Math.abs(dx);
  const cross = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
  return primary + cross * 1.5;
}

function navigate(dir: Dir): boolean {
  const current = document.activeElement as HTMLElement | null;
  if (!current || current === document.body) {
    // Nothing focused → grab the first focusable as a starting point.
    const first = visibleFocusables()[0];
    if (first) {
      first.focus();
      return true;
    }
    return false;
  }
  const fromRect = current.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const el of visibleFocusables()) {
    if (el === current) continue;
    const d = directedDistance(fromRect, el.getBoundingClientRect(), dir);
    if (d !== null && d < bestDist) {
      bestDist = d;
      best = el;
    }
  }
  if (!best) return false;
  best.focus();
  best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return true;
}

const KEY_TO_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function installSpatialNav(): void {
  if (typeof document === "undefined") return;
  document.addEventListener("keydown", (e) => {
    const dir = KEY_TO_DIR[e.key];
    if (!dir) return;
    const active = document.activeElement;
    // Let inputs/textareas swallow arrow keys for caret movement.
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
    ) {
      return;
    }
    // Iframe-focused: the keydown won't bubble to us anyway, but if it
    // somehow does, leave focus alone.
    if (active instanceof HTMLIFrameElement) return;
    if (navigate(dir)) e.preventDefault();
  });
}
