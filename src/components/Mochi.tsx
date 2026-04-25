import { cn } from "@/lib/utils";

type Props = {
  size?: number;
  /** When true, mochi squishes faster and emits steam dots. */
  typing?: boolean;
  /** When true, mochi smiles wider and looks up. */
  happy?: boolean;
  className?: string;
};

/**
 * Mochi — a plump pink rice-cake assistant.
 *
 * Implementation notes:
 *   - The whole creature lives in one SVG so its scale stays consistent.
 *   - .mochi-body breathes (idle) or squishes (typing) via index.css.
 *   - .mochi-eye blinks every ~5s.
 *   - The three .steam circles only animate when typing=true (we render them
 *     at full opacity with the rise animation; idle hides them with opacity).
 */
export function Mochi({ size = 96, typing = false, happy = false, className }: Props) {
  return (
    <div
      className={cn(
        "relative inline-flex items-end justify-center",
        typing && "mochi-typing",
        className,
      )}
      style={{ width: size, height: size * 1.05 }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size * 1.05}
        className="overflow-visible"
      >
        <defs>
          <radialGradient id="mochi-skin" cx="40%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#ffe6e0" />
            <stop offset="55%" stopColor="#f7b7b0" />
            <stop offset="100%" stopColor="#e5938b" />
          </radialGradient>
          <radialGradient id="mochi-cheek" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f59389" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#f59389" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* steam dots — visible only when typing */}
        <g
          style={{ opacity: typing ? 1 : 0, transition: "opacity 240ms ease" }}
        >
          <circle className="steam" cx="42" cy="14" r="2.5" fill="#fff8ea" stroke="#e5d5bc" strokeWidth="0.6" />
          <circle className="steam steam-2" cx="60" cy="10" r="2.2" fill="#fff8ea" stroke="#e5d5bc" strokeWidth="0.6" />
          <circle className="steam steam-3" cx="78" cy="14" r="2.5" fill="#fff8ea" stroke="#e5d5bc" strokeWidth="0.6" />
        </g>

        {/* shadow under mochi */}
        <ellipse cx="60" cy="112" rx="32" ry="4" fill="#2a2421" opacity="0.13" />

        {/* the body — squishy pebble shape */}
        <g className="mochi-body">
          <path
            d="M60 26
               C 90 26, 106 46, 102 70
               C 98 94, 80 108, 60 108
               C 40 108, 22 94, 18 70
               C 14 46, 30 26, 60 26 Z"
            fill="url(#mochi-skin)"
            stroke="#cf7a72"
            strokeWidth="1.2"
          />
          {/* a soft top sheen */}
          <path
            d="M38 38 C 44 30, 56 28, 64 32"
            fill="none"
            stroke="#fff8ea"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.7"
          />
          {/* speckle highlight */}
          <ellipse cx="44" cy="46" rx="9" ry="5" fill="#fff8ea" opacity="0.55" />

          {/* cheeks */}
          <ellipse cx="38" cy="76" rx="8" ry="5" fill="url(#mochi-cheek)" />
          <ellipse cx="82" cy="76" rx="8" ry="5" fill="url(#mochi-cheek)" />

          {/* eyes — separate <g> per eye so each blinks around its own center */}
          <g transform="translate(48 64)">
            <g className="mochi-eye" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
              <ellipse cx="0" cy="0" rx="3" ry="4.6" fill="#2a2421" />
              <circle cx="1" cy="-1.6" r="1.1" fill="#fff8ea" />
              <circle cx="-1" cy="1.4" r="0.5" fill="#fff8ea" />
            </g>
          </g>
          <g transform="translate(72 64)">
            <g className="mochi-eye" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
              <ellipse cx="0" cy="0" rx="3" ry="4.6" fill="#2a2421" />
              <circle cx="1" cy="-1.6" r="1.1" fill="#fff8ea" />
              <circle cx="-1" cy="1.4" r="0.5" fill="#fff8ea" />
            </g>
          </g>

          {/* mouth: smile changes width with happy */}
          {happy ? (
            <path
              d="M52 80 Q60 90 68 80 Q60 86 52 80 Z"
              fill="#9d3f37"
              stroke="#2a2421"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          ) : (
            <path
              d="M54 80 Q60 86 66 80"
              fill="none"
              stroke="#2a2421"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          )}

          {/* a tiny dot on the head, like a sweet rice grain */}
          <circle cx="60" cy="32" r="1.6" fill="#cf7a72" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}
