/**
 * One-off setup for Mochi's "product manager" Conversational AI agent.
 *
 * Usage:
 *   bun src/server/PmAgent.ts
 *
 *   - First run (MOCHI_PM_AGENT_ID unset): POST /v1/convai/agents/create.
 *     Prints the new agent_id; add it to .env as MOCHI_PM_AGENT_ID and
 *     restart the server.
 *   - Subsequent runs (MOCHI_PM_AGENT_ID set): PATCH the existing agent
 *     so prompt / tools / voice tweaks here flow through without making
 *     a new agent.
 *
 * Why a standalone script instead of provisioning at server boot:
 *   creating an agent is a side-effecting one-time setup, and writing
 *   back to .env automatically is fragile. A CLI step keeps the
 *   handshake explicit and the agent stable across restarts.
 *
 * The agent talks to a kid in voice and ends by calling the
 * `submit_requirements` client tool with a complete English spec.
 * The browser intercepts that tool call (via @elevenlabs/client's
 * clientTools) and POSTs to /api/apps to kick off the build.
 */

const API_BASE = "https://api.elevenlabs.io";
const VOICE_ID = process.env["MOCHI_TTS_VOICE_ID"] ?? "21m00Tcm4TlvDq8ikWAM";

// Default first message — overridden per session by KidPMOverlay so
// we can switch between greeting (create) and "what should I change?"
// (modify) without making a second agent.
const FIRST_MESSAGE =
  "Hi! It's Mochi! What should we make for you today?";

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
- Be warm and a touch silly. Use plain kid English.
- ONE question at a time, ONE sentence each. No multi-part questions.
- If they're unsure, suggest options ("blue or pink?", "with sounds or quiet?").
- Match their energy — if they sound bored, hurry up.

Hard rules:
- For create: never more than 4 questions. For modify: never more than 2.
- When you have enough info, say one short upbeat line ("Awesome, I'm
  gonna make it now!" for create, or "Got it, fixing it now!" for
  modify) and IMMEDIATELY call submit_requirements. Do not keep talking
  after the call.
- The spec you pass MUST be in English.
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

const conversationalConfig = {
  agent: {
    first_message: FIRST_MESSAGE,
    language: "en",
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
    model_id: "eleven_flash_v2",
    voice_id: VOICE_ID,
  },
  turn: {
    turn_timeout: 7,
  },
  conversation: {
    max_duration_seconds: 600,
  },
};

async function main() {
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set in .env");
    process.exit(1);
  }

  const existing = process.env["MOCHI_PM_AGENT_ID"];
  if (existing) {
    console.log(`updating existing agent ${existing}…`);
    const res = await fetch(`${API_BASE}/v1/convai/agents/${existing}`, {
      method: "PATCH",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ conversation_config: conversationalConfig }),
    });
    if (!res.ok) {
      console.error(`PATCH failed: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    console.log(`agent ${existing} updated.`);
    return;
  }

  console.log("creating new PM agent…");
  const res = await fetch(`${API_BASE}/v1/convai/agents/create`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Mochi PM",
      conversation_config: conversationalConfig,
    }),
  });
  if (!res.ok) {
    console.error(`create failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const json = (await res.json()) as { agent_id: string };
  console.log("");
  console.log("✓ Created agent:");
  console.log(`  MOCHI_PM_AGENT_ID=${json.agent_id}`);
  console.log("");
  console.log("Add the line above to .env, then restart the server.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
