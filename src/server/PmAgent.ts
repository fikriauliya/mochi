/**
 * One-off setup for Mochi's "product manager" Conversational AI agents.
 *
 * Two agents — one Indonesian, one English — provisioned + maintained
 * by this script. The browser picks which to connect to based on the
 * lang chip; no per-session overrides involved (cleaner than wrestling
 * ElevenLabs' override allowlist + multilingual-model constraints).
 *
 * Usage:
 *   bun src/server/PmAgent.ts
 *
 *   Creates whichever agents aren't yet provisioned and PATCHes the
 *   ones that are. Prints any newly-minted agent_ids — paste them into
 *   `.env` as `MOCHI_PM_AGENT_ID_ID` and `MOCHI_PM_AGENT_ID_EN`.
 *
 * The agent talks to a kid in voice and ends by calling the
 * `submit_requirements` client tool with a complete English spec.
 * The browser intercepts that tool call (via @elevenlabs/client's
 * clientTools) and POSTs to /api/apps to kick off the build.
 */

const API_BASE = "https://api.elevenlabs.io";
const VOICE_ID = process.env["MOCHI_TTS_VOICE_ID"] ?? "21m00Tcm4TlvDq8ikWAM";

const FIRST_MESSAGE_ID = "Hai! Aku Mochi! Mau bikin apa hari ini?";
const FIRST_MESSAGE_EN = "Hi! It's Mochi! What should we make for you today?";

const SYSTEM_PROMPT = `
You are Mochi, a friendly cooking-mascot acting as a kid's product manager.

This session's context (filled at runtime):
- intent: {{intent}}                    (either "create" or "modify")
- output_kind: {{output_kind}}          ("app" or "printable")
- existing_name: {{existing_name}}      (only meaningful when intent=modify)
- existing_description: {{existing_description}}

If intent is "create":
  A child wants you to build them a small {{output_kind}} (interactive
  React web app, or printable A4 infographic). Ask 2 to 4 SHORT questions
  in a warm playful tone to figure out what they want, then submit the
  spec for the build team. Aim for 2-3 questions; never more than 4.
  What to ask about (pick what's relevant — you don't need all):
  - the topic or theme
  - the colors or feel
  - any special features (timer, sound, scoreboard, sticker chart…)
  - for printables: what should be on the paper

If intent is "modify":
  The kid already has an app called "{{existing_name}}" —
  {{existing_description}}. They want to TWEAK it. Ask just 1 to 2
  SHORT questions to nail down the change, then submit. Be quick —
  modifications are usually small ("make it purple", "add a timer").
  Don't re-litigate the original design; just capture the change.

Style (both modes):
- Be warm and a touch silly. Use plain kid language.
- ONE question at a time, ONE sentence each. No multi-part questions.
- If they're unsure, suggest options ("blue or pink?", "with sounds or quiet?").
- Match their energy — if they sound bored, hurry up.

Hard rules:
- For create: never more than 4 questions. For modify: never more than 2.
- When you have enough info, say one short upbeat line ("Awesome, I'm
  gonna make it now!" / "Beres, Mochi bikin sekarang!") and IMMEDIATELY
  call submit_requirements. Do not keep talking after the call.
- Speak in the language of this agent (whichever was configured at
  agent setup). Stay kid-simple.
- The spec you pass MUST be in English regardless of conversation
  language — claude downstream needs English.
  - create: 2 to 4 sentences. Restate the topic, the look, and any
    features the kid asked for. Detailed enough an engineer could build
    it without asking more questions.
  - modify: 1 to 3 sentences describing JUST the change(s). Don't
    restate the whole app — say only what to change.
`.trim();

const TOOL_SUBMIT = {
  type: "client" as const,
  name: "submit_requirements",
  description:
    "Send the final spec to the build team. Call this exactly once, after you've gathered enough info from the kid. Do not call it on the first turn.",
  parameters: {
    type: "object" as const,
    properties: {
      spec: {
        type: "string" as const,
        description:
          "The complete English spec, 2-4 sentences. Restate the topic/theme, the look (colors, mood), and any features the kid asked for.",
      },
    },
    required: ["spec"],
  },
  expects_response: true,
};

type Variant = {
  envVar: "MOCHI_PM_AGENT_ID_ID" | "MOCHI_PM_AGENT_ID_EN";
  name: string;
  language: string;
  firstMessage: string;
  // ElevenLabs requires English-primary agents to use turbo or flash v2;
  // multilingual models are gated to non-English primaries. Indonesian
  // agent therefore gets a multilingual model (kid speech in any accent
  // works), English agent stays on flash_v2.
  ttsModel: string;
};

const VARIANTS: ReadonlyArray<Variant> = [
  {
    envVar: "MOCHI_PM_AGENT_ID_ID",
    name: "Mochi PM (id)",
    language: "id",
    firstMessage: FIRST_MESSAGE_ID,
    ttsModel: "eleven_turbo_v2_5",
  },
  {
    envVar: "MOCHI_PM_AGENT_ID_EN",
    name: "Mochi PM (en)",
    language: "en",
    firstMessage: FIRST_MESSAGE_EN,
    ttsModel: "eleven_flash_v2",
  },
];

function buildConfig(v: Variant) {
  return {
    agent: {
      first_message: v.firstMessage,
      language: v.language,
      // iPad mics activate noisier than Macs (worklet warm-up, ambient
      // noise, breath) and that audio reads as "user is talking" to
      // ElevenLabs' VAD before initial_wait_time fires — so the agent
      // skips the first_message entirely and waits for end-of-turn.
      // Locking out interruptions during the first message means the
      // greeting always plays even if the mic produces a half-second
      // of garbage at session start.
      disable_first_message_interruptions: true,
      prompt: {
        prompt: SYSTEM_PROMPT,
        llm: "gemini-2.5-flash",
        tools: [TOOL_SUBMIT],
      },
    },
    asr: {
      quality: "high",
      provider: "elevenlabs",
      user_input_audio_format: "pcm_16000",
    },
    tts: {
      model_id: v.ttsModel,
      voice_id: VOICE_ID,
    },
    turn: {
      turn_timeout: 7,
      // Speak the first_message ~immediately on connect instead of
      // waiting for the kid to talk first. 1s is the minimum the API
      // accepts.
      initial_wait_time: 1,
    },
    conversation: {
      max_duration_seconds: 600,
    },
  };
}

async function patchAgent(apiKey: string, id: string, v: Variant) {
  const res = await fetch(`${API_BASE}/v1/convai/agents/${id}`, {
    method: "PATCH",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ conversation_config: buildConfig(v) }),
  });
  if (!res.ok) {
    throw new Error(`PATCH ${id} ${res.status}: ${await res.text()}`);
  }
}

async function createAgent(apiKey: string, v: Variant): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/convai/agents/create`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ name: v.name, conversation_config: buildConfig(v) }),
  });
  if (!res.ok) {
    throw new Error(`create ${v.name} ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { agent_id: string };
  return json.agent_id;
}

async function main() {
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set in .env");
    process.exit(1);
  }

  const newlyCreated: string[] = [];
  for (const v of VARIANTS) {
    // Backwards compat: if the legacy `MOCHI_PM_AGENT_ID` is set and the
    // _ID-suffixed slot is empty, treat the legacy id as the Indonesian
    // agent (current default — primary lang was already flipped to id
    // in a prior commit).
    const existing =
      process.env[v.envVar] ??
      (v.envVar === "MOCHI_PM_AGENT_ID_ID"
        ? process.env["MOCHI_PM_AGENT_ID"]
        : undefined);

    if (existing) {
      console.log(`updating ${v.name} (${existing})…`);
      await patchAgent(apiKey, existing, v);
      console.log(`  ✓ updated`);
    } else {
      console.log(`creating ${v.name}…`);
      const id = await createAgent(apiKey, v);
      console.log(`  ✓ ${v.envVar}=${id}`);
      newlyCreated.push(`${v.envVar}=${id}`);
    }
  }

  if (newlyCreated.length > 0) {
    console.log("");
    console.log("Add to .env then restart the server:");
    for (const line of newlyCreated) console.log(`  ${line}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
