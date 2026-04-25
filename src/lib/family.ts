export type FamilyId = "dad" | "mom" | "aira" | "kenji";

export type FamilyMember = {
  id: FamilyId;
  name: string;
  short: string;
  role: string;
  /** Used to vary mock replies. */
  tone: "warm-grownup" | "warm-grownup-mom" | "playful-girl" | "playful-boy";
  /** Tailwind classes — we keep them static so JIT picks them up. */
  classes: {
    bg: string;
    bgSoft: string;
    text: string;
    ring: string;
    border: string;
  };
};

export const FAMILY: Record<FamilyId, FamilyMember> = {
  dad: {
    id: "dad",
    name: "Dad",
    short: "D",
    role: "the planner",
    tone: "warm-grownup",
    classes: {
      bg: "bg-dad",
      bgSoft: "bg-dad-soft",
      text: "text-dad",
      ring: "ring-dad",
      border: "border-dad",
    },
  },
  mom: {
    id: "mom",
    name: "Mom",
    short: "M",
    role: "the storyteller",
    tone: "warm-grownup-mom",
    classes: {
      bg: "bg-mom",
      bgSoft: "bg-mom-soft",
      text: "text-mom",
      ring: "ring-mom",
      border: "border-mom",
    },
  },
  aira: {
    id: "aira",
    name: "Aira",
    short: "A",
    role: "age 8 · curious",
    tone: "playful-girl",
    classes: {
      bg: "bg-aira",
      bgSoft: "bg-aira-soft",
      text: "text-aira",
      ring: "ring-aira",
      border: "border-aira",
    },
  },
  kenji: {
    id: "kenji",
    name: "Kenji",
    short: "K",
    role: "age 6 · explorer",
    tone: "playful-boy",
    classes: {
      bg: "bg-kenji",
      bgSoft: "bg-kenji-soft",
      text: "text-kenji",
      ring: "ring-kenji",
      border: "border-kenji",
    },
  },
};

export const FAMILY_LIST: FamilyMember[] = [
  FAMILY.dad,
  FAMILY.mom,
  FAMILY.aira,
  FAMILY.kenji,
];
