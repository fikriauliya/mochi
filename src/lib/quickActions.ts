import {
  BookOpen,
  ChefHat,
  Sparkles,
  CalendarHeart,
  Palette,
  Moon,
  type LucideIcon,
} from "lucide-react";

export type QuickAction = {
  id: string;
  icon: LucideIcon;
  title: string;
  example: string;
  /** Tailwind soft-tint background + matching ink for the icon. */
  tone: { bg: string; ink: string };
};

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "homework",
    icon: BookOpen,
    title: "Homework helper",
    example: "What is a fraction, with sandwich examples?",
    tone: { bg: "bg-aira-soft", ink: "text-aira" },
  },
  {
    id: "dinner",
    icon: ChefHat,
    title: "Dinner ideas",
    example: "Quick dinner with chicken, rice and broccoli?",
    tone: { bg: "bg-mom-soft", ink: "text-mom" },
  },
  {
    id: "story",
    icon: Sparkles,
    title: "Tell me a story",
    example: "A short story about a brave little kitten.",
    tone: { bg: "bg-mochi-soft", ink: "text-mochi-deep" },
  },
  {
    id: "weekend",
    icon: CalendarHeart,
    title: "Plan our weekend",
    example: "Three fun, mostly-free things to do Saturday.",
    tone: { bg: "bg-dad-soft", ink: "text-dad" },
  },
  {
    id: "draw",
    icon: Palette,
    title: "Drawing ideas",
    example: "What should I draw today? Easy, please.",
    tone: { bg: "bg-kenji-soft", ink: "text-kenji" },
  },
  {
    id: "bedtime",
    icon: Moon,
    title: "Bedtime questions",
    example: "Why do stars twinkle at night?",
    tone: { bg: "bg-paper-shadow", ink: "text-ink-soft" },
  },
];
