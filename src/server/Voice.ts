import { Context, Data, Effect, Layer } from "effect";

/**
 * Server-side proxy to ElevenLabs for voice in/out. Keeps the API key
 * off the client and lets us swap voices/models via .env without
 * shipping a new bundle.
 *
 *   STT: POST /v1/speech-to-text  (multipart audio, model: scribe_v1)
 *   TTS: POST /v1/text-to-speech/{voice_id}  (json text, model: eleven_turbo_v2_5)
 *
 * Auth: `xi-api-key: $ELEVENLABS_API_KEY`. Bun auto-loads `.env`.
 *
 * Defaults:
 *   MOCHI_TTS_VOICE_ID  — multilingual female voice ID (Rachel)
 *   MOCHI_TTS_MODEL     — eleven_turbo_v2_5 (fast, multilingual)
 *   MOCHI_STT_MODEL     — scribe_v1
 */

export class VoiceError extends Data.TaggedError("VoiceError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class VoiceService extends Context.Tag("VoiceService")<
  VoiceService,
  {
    /** Send raw audio bytes to ElevenLabs STT and return the transcript. */
    readonly transcribe: (
      audio: Uint8Array,
      mimeType: string,
      lang?: string,
    ) => Effect.Effect<string, VoiceError>;

    /** Render `text` to MP3 via ElevenLabs TTS. */
    readonly synthesize: (
      text: string,
    ) => Effect.Effect<Uint8Array, VoiceError>;
  }
>() {}

const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const TTS_URL = (voiceId: string) =>
  `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — multilingual, warm
const DEFAULT_TTS_MODEL = "eleven_turbo_v2_5";
const DEFAULT_STT_MODEL = "scribe_v1";

const apiKey = (): string | null => process.env["ELEVENLABS_API_KEY"] ?? null;

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export const VoiceLive = Layer.succeed(
  VoiceService,
  VoiceService.of({
    transcribe: (audio, mimeType, lang) =>
      Effect.gen(function* () {
        const key = apiKey();
        if (!key) {
          return yield* Effect.fail(
            new VoiceError({
              message: "ELEVENLABS_API_KEY is not set in .env",
            }),
          );
        }

        const t0 = Date.now();
        const form = new FormData();
        form.append(
          "file",
          new Blob([audio as unknown as ArrayBuffer], { type: mimeType }),
          "audio",
        );
        form.append("model_id", process.env["MOCHI_STT_MODEL"] ?? DEFAULT_STT_MODEL);
        if (lang) form.append("language_code", lang);

        const res = yield* Effect.tryPromise({
          try: () =>
            fetch(STT_URL, {
              method: "POST",
              headers: { "xi-api-key": key },
              body: form,
            }),
          catch: (cause) =>
            new VoiceError({ message: "STT network error", cause }),
        });

        if (!res.ok) {
          const body = yield* Effect.promise(() => readErrorBody(res));
          return yield* Effect.fail(
            new VoiceError({ message: `STT ${res.status}: ${body}` }),
          );
        }

        const json = yield* Effect.tryPromise({
          try: () =>
            res.json() as Promise<{ text?: string; language_code?: string }>,
          catch: (cause) =>
            new VoiceError({ message: "STT response not JSON", cause }),
        });
        const text = (json.text ?? "").trim();
        yield* Effect.log(
          `[stt] ${audio.byteLength}B (${mimeType}) → "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}" in ${Date.now() - t0}ms`,
        );
        return text;
      }),

    synthesize: (text) =>
      Effect.gen(function* () {
        const key = apiKey();
        if (!key) {
          return yield* Effect.fail(
            new VoiceError({
              message: "ELEVENLABS_API_KEY is not set in .env",
            }),
          );
        }

        const voiceId =
          process.env["MOCHI_TTS_VOICE_ID"] ?? DEFAULT_VOICE_ID;
        const modelId =
          process.env["MOCHI_TTS_MODEL"] ?? DEFAULT_TTS_MODEL;

        const t0 = Date.now();
        const res = yield* Effect.tryPromise({
          try: () =>
            fetch(TTS_URL(voiceId), {
              method: "POST",
              headers: {
                "xi-api-key": key,
                "content-type": "application/json",
                accept: "audio/mpeg",
              },
              body: JSON.stringify({
                text,
                model_id: modelId,
                // turbo_v2_5 is multilingual — auto-detects from text;
                // no need to pass language_code explicitly.
              }),
            }),
          catch: (cause) =>
            new VoiceError({ message: "TTS network error", cause }),
        });

        if (!res.ok) {
          const body = yield* Effect.promise(() => readErrorBody(res));
          return yield* Effect.fail(
            new VoiceError({ message: `TTS ${res.status}: ${body}` }),
          );
        }

        const buf = yield* Effect.tryPromise({
          try: () => res.arrayBuffer(),
          catch: (cause) =>
            new VoiceError({ message: "TTS read failed", cause }),
        });
        const bytes = new Uint8Array(buf);
        yield* Effect.log(
          `[tts] ${text.length} chars → ${bytes.byteLength}B mp3 in ${Date.now() - t0}ms`,
        );
        return bytes;
      }),
  }),
);
