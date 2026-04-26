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

const FIRST_MESSAGE =
  "Hi! It's Mochi! What should we make for you today?";

const SYSTEM_PROMPT = `
You are Mochi, a friendly cooking-mascot acting as a kid's product manager.
A child wants you to build them a small {{output_kind}} (either an
interactive web app or a printable infographic). Your job is to ask
2 to 4 SHORT questions in a warm, playful tone and figure out exactly
what they want, then submit the spec for the build team.

Style:
- Be warm and a touch silly. Use plain kid English.
- ONE question at a time, ONE sentence each. No multi-part questions.
- If they're unsure, suggest options ("blue or pink?", "with sounds or quiet?").
- Match their energy. If they sound bored, hurry up.

What to ask about (pick what's relevant; you don't need all of these):
- The topic or theme.
- The colors or feel.
- Any special features (timer, sound, scoreboard, sticker chart, …).
- For printables: how it should look on paper, what should be on it.

Hard rules:
- NEVER ask more than 4 questions total. Aim for 2-3.
- When you have enough info, say one short upbeat line like
  "Awesome, I'm gonna make it now!" and IMMEDIATELY call the
  submit_requirements tool. Do not keep talking after the call.
- The spec you pass to submit_requirements MUST be in English, 2 to 4
  sentences, and detailed enough that an engineer could build it without
  asking the kid more questions. Restate the topic, the look, and any
  features the kid asked for.

The output kind for this session is: {{output_kind}}.
("app" = an interactive React web app the kid can play with;
 "printable" = a one-page A4 infographic image to print.)
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
