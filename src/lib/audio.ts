/**
 * Pre-warm the browser's audio output so the PM agent's `first_message`
 * actually plays on iPad / iOS Safari & Chrome.
 *
 * iOS WebKit gates `AudioContext` playback behind a *fresh* user
 * gesture — and "fresh" means in the same call stack as the audio
 * operation. The home mic tap is plenty of gesture, but by the time
 * `Conversation.startSession` has fetched a signed URL, opened a
 * WebSocket, and decoded the first audio frame (1–3 s later), iOS
 * has decided the gesture is stale and silently mutes playback. The
 * agent then sits there speaking into the void until the kid speaks
 * — at which point a fresh gesture unlocks audio and the next agent
 * turn lands as normal.
 *
 * The fix: synchronously create + resume an `AudioContext` *during*
 * the first gesture, and play a 1-sample silent buffer through it.
 * iOS counts the page as "audio-unlocked" for the rest of the
 * document; the SDK's own `AudioContext` (created later) inherits
 * that state.
 *
 * Mac/desktop Chrome doesn't care — it'll happily play through any
 * post-gesture context. The cost on those is one inaudible click and
 * a 1-byte `AudioBuffer`. Safe everywhere.
 */

let ctx: AudioContext | null = null;

type AudioContextCtor = typeof AudioContext;
type WindowWithWebkit = Window & {
  webkitAudioContext?: AudioContextCtor;
};

export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  if (ctx) {
    // Re-resume if iOS auto-suspended it (e.g., tab backgrounded).
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return;
  }
  const w = window as WindowWithWebkit;
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return;
  try {
    ctx = new Ctor();
    void ctx.resume().catch(() => {});
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // No Web Audio support, or the context constructor threw — degrade
    // silently. The agent will still speak on platforms that don't
    // require this dance.
  }
}
