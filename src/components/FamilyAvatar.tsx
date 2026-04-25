import type { FamilyId } from "@/lib/family";
import { cn } from "@/lib/utils";

type Props = {
  id: FamilyId;
  size?: number;
  className?: string;
};

/**
 * Hand-drawn-feeling SVG portraits. Each member has a unique silhouette
 * (hair, glasses, accessory) plus their family color.
 */
export function FamilyAvatar({ id, size = 48, className }: Props) {
  const stroke = "#2a2421";
  const sw = 1.6;

  const inner = (() => {
    switch (id) {
      case "dad":
        return (
          <>
            <circle cx="50" cy="50" r="40" fill="var(--color-dad)" />
            {/* hair: short flat-top */}
            <path
              d="M16 44 C 18 26, 38 16, 50 16 C 64 16, 82 26, 84 44 L 80 44 C 76 38, 68 30, 50 30 C 36 30, 26 38, 20 44 Z"
              fill="#1a1612"
            />
            {/* glasses */}
            <g fill="none" stroke={stroke} strokeWidth={sw}>
              <circle cx="40" cy="52" r="7" />
              <circle cx="60" cy="52" r="7" />
              <path d="M47 52 L53 52" />
              <path d="M33 52 L29 50" />
              <path d="M67 52 L71 50" />
            </g>
            {/* nose */}
            <path d="M50 56 L48 62 L52 62" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
            {/* smile */}
            <path d="M42 70 Q50 76 58 70" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
            {/* short beard */}
            <path d="M40 72 Q50 80 60 72 Q58 80 50 82 Q42 80 40 72 Z" fill="#1a1612" opacity="0.8" />
          </>
        );

      case "mom":
        return (
          <>
            <circle cx="50" cy="50" r="40" fill="var(--color-mom)" />
            {/* hair down with a top knot */}
            <path d="M14 56 C 14 28, 30 14, 50 14 C 70 14, 86 28, 86 56 C 80 50, 76 46, 72 44 C 70 38, 58 32, 50 32 C 42 32, 30 38, 28 44 C 24 46, 20 50, 14 56 Z" fill="#3a1d12" />
            {/* top knot */}
            <ellipse cx="50" cy="14" rx="8" ry="5.5" fill="#3a1d12" />
            <ellipse cx="50" cy="12" rx="3" ry="2" fill="#5a2c1a" opacity="0.8" />
            {/* small flower accent */}
            <g transform="translate(64 26)">
              <circle r="2.6" fill="#fff8ea" />
              <circle r="1.1" fill="#d96241" />
            </g>
            {/* eyes */}
            <ellipse cx="40" cy="52" rx="2.2" ry="3" fill={stroke} />
            <ellipse cx="60" cy="52" rx="2.2" ry="3" fill={stroke} />
            <circle cx="40.7" cy="51" r="0.6" fill="#fff" />
            <circle cx="60.7" cy="51" r="0.6" fill="#fff" />
            {/* blush */}
            <ellipse cx="34" cy="62" rx="3.5" ry="2" fill="#fff" opacity="0.35" />
            <ellipse cx="66" cy="62" rx="3.5" ry="2" fill="#fff" opacity="0.35" />
            {/* smile */}
            <path d="M42 68 Q50 74 58 68" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          </>
        );

      case "aira":
        return (
          <>
            <circle cx="50" cy="50" r="40" fill="var(--color-aira)" />
            {/* twin pigtails: hair around face */}
            <path d="M16 52 C 16 28, 32 16, 50 16 C 68 16, 84 28, 84 52 C 80 50, 78 48, 76 48 C 74 38, 62 32, 50 32 C 38 32, 26 38, 24 48 C 22 48, 20 50, 16 52 Z" fill="#3b2a52" />
            {/* pigtails */}
            <ellipse cx="14" cy="58" rx="6" ry="9" fill="#3b2a52" />
            <ellipse cx="86" cy="58" rx="6" ry="9" fill="#3b2a52" />
            {/* ribbons */}
            <rect x="9" y="64" width="10" height="3" rx="1.5" fill="#fff8ea" />
            <rect x="81" y="64" width="10" height="3" rx="1.5" fill="#fff8ea" />
            {/* eyes (big sparkly) */}
            <ellipse cx="40" cy="54" rx="3" ry="4" fill={stroke} />
            <ellipse cx="60" cy="54" rx="3" ry="4" fill={stroke} />
            <circle cx="41" cy="52.5" r="0.9" fill="#fff" />
            <circle cx="61" cy="52.5" r="0.9" fill="#fff" />
            <circle cx="39" cy="56" r="0.5" fill="#fff" />
            <circle cx="59" cy="56" r="0.5" fill="#fff" />
            {/* blush */}
            <ellipse cx="34" cy="62" rx="3.5" ry="2" fill="#fff" opacity="0.5" />
            <ellipse cx="66" cy="62" rx="3.5" ry="2" fill="#fff" opacity="0.5" />
            {/* tiny smile */}
            <path d="M44 68 Q50 73 56 68" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          </>
        );

      case "kenji":
        return (
          <>
            <circle cx="50" cy="50" r="40" fill="var(--color-kenji)" />
            {/* spiky hair tufts */}
            <path d="M22 38 L 28 18 L 34 36 L 40 14 L 46 34 L 52 16 L 58 36 L 64 18 L 70 36 L 78 22 L 78 44 L 22 44 Z" fill="#2a1a08" />
            {/* eyes */}
            <ellipse cx="40" cy="56" rx="2.6" ry="3.4" fill={stroke} />
            <ellipse cx="60" cy="56" rx="2.6" ry="3.4" fill={stroke} />
            <circle cx="40.7" cy="55" r="0.7" fill="#fff" />
            <circle cx="60.7" cy="55" r="0.7" fill="#fff" />
            {/* blush */}
            <ellipse cx="34" cy="64" rx="3.5" ry="2" fill="#fff" opacity="0.45" />
            <ellipse cx="66" cy="64" rx="3.5" ry="2" fill="#fff" opacity="0.45" />
            {/* big grin showing tooth gap */}
            <path d="M40 70 Q50 78 60 70 Q56 74 50 74 Q44 74 40 70 Z" fill={stroke} />
            <rect x="48" y="72" width="2" height="3" fill="#fff8ea" />
          </>
        );
    }
  })();

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {/* outer hand-drawn ring */}
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="1.5"
        strokeDasharray="2 3"
        opacity="0.18"
      />
      {inner}
    </svg>
  );
}
