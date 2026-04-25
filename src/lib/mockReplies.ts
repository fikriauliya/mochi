import type { FamilyMember } from "./family";

type Topic =
  | "homework"
  | "dinner"
  | "story"
  | "weekend"
  | "draw"
  | "bedtime"
  | "feelings"
  | "fallback";

const TOPIC_PATTERNS: { topic: Topic; pattern: RegExp }[] = [
  { topic: "homework", pattern: /(homework|math|fraction|spell|read|science|study|school)/i },
  { topic: "dinner", pattern: /(dinner|cook|recipe|food|breakfast|lunch|hungry|meal|eat)/i },
  { topic: "story", pattern: /(story|tale|once upon|kitten|dragon|princess|adventure)/i },
  { topic: "weekend", pattern: /(weekend|saturday|sunday|trip|plan|go out|park|outing)/i },
  { topic: "draw", pattern: /(draw|drawing|paint|color|art|sketch|doodle)/i },
  { topic: "bedtime", pattern: /(bedtime|sleep|moon|star|night|why|dream|nightmare)/i },
  { topic: "feelings", pattern: /(sad|angry|cry|scared|worried|tired|frustrat|miss)/i },
];

function detectTopic(input: string): Topic {
  for (const { topic, pattern } of TOPIC_PATTERNS) {
    if (pattern.test(input)) return topic;
  }
  return "fallback";
}

/* ------- Replies, varied by speaker tone ------- */

const REPLIES: Record<Topic, Record<FamilyMember["tone"], string>> = {
  homework: {
    "warm-grownup":
      "Happy to help. Send the question (or a photo) and we'll work it through one step at a time — and I'll show the working so you can check.",
    "warm-grownup-mom":
      "Of course — let's do it together. Tell me the topic and what's already been tried, and I'll suggest the gentlest next step.",
    "playful-girl":
      "Ooh, homework time! Tell me what it's about, and I'll explain it like a story. Fractions are basically pizza slices, by the way.",
    "playful-boy":
      "Cool, brain-quest time! Pick the trickiest question — we'll beat it together. Pretend each answer earns a sticker.",
  },
  dinner: {
    "warm-grownup":
      "Quick option: 20-minute chicken-fried-rice — sauté chicken cubes, throw in cold rice and any veg, soy + sesame, fried egg on top. Want a vegetarian version?",
    "warm-grownup-mom":
      "How about a one-pan miso butter chicken with rice? Tender, mild for the kids, and the pan only takes one wash. I can also do a 15-minute pasta if you're tired.",
    "playful-girl":
      "DINNER IDEAS! 🍜 What's in the fridge? I'm pretending to be a tiny chef in a tall hat. We could do rainbow rice bowls.",
    "playful-boy":
      "Pizza? Tacos? Dragon noodles?! 🐉 If you tell me one thing in the fridge, I'll build a whole meal around it. Ready?",
  },
  story: {
    "warm-grownup":
      "Sure — a short bedtime-friendly one or a longer adventure? I can pitch three openings; pick your favourite and I'll write the rest.",
    "warm-grownup-mom":
      "I love story time. Want a calm one for winding down, or a brave one for the morning? Tell me a hero's name and a place.",
    "playful-girl":
      "Once upon a time, a kitten named Pickle found a tiny door inside the fridge. Should the door go to a cloud kingdom, or a cookie forest? You pick!",
    "playful-boy":
      "Once there was a shark named Bonk who was scared of bathtubs. One day a bubble whispered his name… want him to find a treasure or a friend?",
  },
  weekend: {
    "warm-grownup":
      "Three options sorted by effort: 1) library + bakery walk, 2) a park you've never tried + picnic, 3) a tiny day-trip — pick a 30-min radius and I'll list ideas.",
    "warm-grownup-mom":
      "How about a slow Saturday — pancakes, the big park, then a craft afternoon? Sunday could be quiet: a movie pile and the long bath.",
    "playful-girl":
      "WEEKEND PLAN! 🗓️ Idea 1: pretend-camping in the living room. Idea 2: ice-cream investigation (visit two shops). Idea 3: museum scavenger hunt. ⭐",
    "playful-boy":
      "BIG plan: go find dinosaurs. (Aka the museum.) Or: bike + slushy mission. Or: build a giant blanket fort. Vote!",
  },
  draw: {
    "warm-grownup":
      "Try a quick page of '5 things on my desk' in 5 minutes — simple lines, no erasing. It's the loosen-up trick I use.",
    "warm-grownup-mom":
      "How about a little drawing of your favourite breakfast? Or a portrait of the cat looking grumpy. I love your style with marker.",
    "playful-girl":
      "Draw a flying jellyfish carrying a cupcake. 🪼🧁 Bonus points if the cupcake is sleeping. I'll guess what colour you'll pick first!",
    "playful-boy":
      "DRAW A ROBOT WHO BAKES. Big arms. Tiny pizza in his hand. Lasers? Up to you. I'll cheer at every line.",
  },
  bedtime: {
    "warm-grownup":
      "Stars 'twinkle' because Earth's air is always wobbling — light bends as it crosses warm and cool air. Planets twinkle less because they look bigger.",
    "warm-grownup-mom":
      "Stars twinkle because the air around our planet wiggles like warm soup, and the starlight wiggles with it. Sweet dreams. 🌙",
    "playful-girl":
      "Stars twinkle because Earth's air is wiggly! It's like looking through a fishbowl, and the stars do a little dance for you. ✨",
    "playful-boy":
      "Twinkly stars are doing aerial somersaults through Earth's wobbly air! Real answer: light + bumpy air = dance party. 🌟",
  },
  feelings: {
    "warm-grownup":
      "That's a lot. Want to tell me what happened, or just sit with it for a minute? No advice unless you ask.",
    "warm-grownup-mom":
      "I'm here. Take a slow breath — in for four, out for six. Tell me what's heaviest right now.",
    "playful-girl":
      "Aw. 💛 Big feelings are okay. Want to tell me about it, or should I send you a tiny happy thing?",
    "playful-boy":
      "That's a hard feeling. Want a hug-emoji 🤗 first, then we talk? You're allowed to feel however you feel.",
  },
  fallback: {
    "warm-grownup":
      "Got it. Tell me a little more — what's the goal here, and what would 'helpful' look like for you?",
    "warm-grownup-mom":
      "Mmm, okay — say a bit more? I want to make sure I help in the right way.",
    "playful-girl":
      "Oooh, interesting! Tell me MORE. Like — what made you think of that?",
    "playful-boy":
      "Ooh okay tell me everything. The wackier the better.",
  },
};

const GREETING: Record<FamilyMember["tone"], (name: string) => string> = {
  "warm-grownup": (n) =>
    `Hey ${n}. What can I take off your plate today — kids' stuff, dinner, plans, or a quick brainstorm?`,
  "warm-grownup-mom": (n) =>
    `Hi ${n} 🌷  Want to plan, vent, cook, or dream? I'm right here.`,
  "playful-girl": (n) =>
    `Hi ${n}! ⭐  Want a story, a puzzle, or do you have a question that's been buzzing in your brain?`,
  "playful-boy": (n) =>
    `Hi ${n}! 🚀  Wanna build something, ask a wild question, or hear a story about a brave shark?`,
};

export function mochiGreet(member: FamilyMember): string {
  return GREETING[member.tone](member.name);
}

export function mochiReply(input: string, member: FamilyMember): string {
  const topic = detectTopic(input);
  return REPLIES[topic][member.tone];
}

/** Roughly 22 chars/sec, with a floor and a ceiling. Used to gate the
 *  fake-typing delay so the response feels paced, not instant. */
export function fakeTypingDelay(reply: string): number {
  const ms = Math.min(2400, Math.max(700, reply.length * 28));
  return ms;
}
