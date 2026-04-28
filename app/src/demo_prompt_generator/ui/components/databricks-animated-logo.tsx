import { motion, useAnimationControls } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

const LOGO_POINTS =
  "0 29.44 0 32.84 52.13 62.25 98.69 35.96 98.7 46.58 52.13 73.04 2.62 44.91 0 46.37 0 66.72 52.13 96.06 98.69 69.86 98.7 80.4 52.13 106.86 2.62 78.73 0 80.19 0 83.64 52.13 112.97 104.26 83.64 104.26 63.27 101.63 61.82 52.13 89.95 5.56 63.49 5.56 53 52.13 79.17 104.26 49.83 104.26 29.76 101.63 28.3 52.13 56.44 7.95 31.33 52.13 6.38 88.52 26.94 91.7 25.15 91.7 22.35 52.13 0";

const VIEW_W = 104.26;
const VIEW_H = 112.97;

// Brick grid — masonry-offset rows for a real wall feel.
const COLS = 5;
const ROWS = 5;
const BRICK_W = VIEW_W / COLS;
const BRICK_H = VIEW_H / ROWS;

const FALL_DURATION = 0.5;
const STAGGER = 0.05;
// The wall takes this long to fully assemble.
const BUILD_TIME = STAGGER * (COLS * ROWS - 1) + FALL_DURATION;

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lower = lays earlier. Bottom-up, weaving left↔right. */
  order: number;
}

function buildBricks(): Brick[] {
  const bricks: Brick[] = [];
  let order = 0;
  // Build bottom-up. Within each row, alternate left→right and right→left
  // for a weaving feel. Plain grid (no horizontal offset) so the full logo
  // is covered without gaps on either edge.
  for (let row = ROWS - 1; row >= 0; row--) {
    const leftToRight = (ROWS - 1 - row) % 2 === 0;
    for (let i = 0; i < COLS; i++) {
      const col = leftToRight ? i : COLS - 1 - i;
      bricks.push({
        x: col * BRICK_W,
        y: row * BRICK_H,
        w: BRICK_W,
        h: BRICK_H,
        order: order++,
      });
    }
  }
  return bricks;
}

const BRICKS = buildBricks();

interface DatabricksAnimatedLogoProps {
  className?: string;
  /** Tint of the logo strata. Defaults to Databricks orange-red. */
  color?: string;
  /** Auto-loop the build animation. Defaults to false (build once). */
  autoLoop?: boolean;
  /** Interval (ms) between auto-loop builds. Defaults to 6000. */
  loopIntervalMs?: number;
}

export function DatabricksAnimatedLogo({
  className,
  color = "#FF3621",
  autoLoop = true,
  loopIntervalMs = 5500,
}: DatabricksAnimatedLogoProps) {
  const uid = useId().replace(/:/g, "");
  const shimmerId = `shimmer-${uid}`;
  const glowId = `glow-${uid}`;

  const bricksControls = useAnimationControls();
  const shimmerControls = useAnimationControls();
  const haloControls = useAnimationControls();
  const [buildKey, setBuildKey] = useState(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Drive the sequence: build → shimmer → halo → (loop)
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const runSequence = async () => {
      if (cancelled) return;
      // Reset everything to pre-build state.
      await bricksControls.start("hidden");
      shimmerControls.set({ x: -VIEW_W * 0.7, opacity: 0 });
      haloControls.set({ opacity: 0, scale: 1 });
      if (cancelled) return;

      // Build the wall.
      await bricksControls.start("visible");
      if (cancelled) return;

      // Shimmer + halo together.
      await Promise.all([
        shimmerControls.start({
          x: [-VIEW_W * 0.7, VIEW_W],
          opacity: [0, 1, 1, 0],
          transition: {
            duration: 0.95,
            times: [0, 0.1, 0.85, 1],
            ease: "easeInOut",
          },
        }),
        haloControls.start({
          opacity: [0, 0.35, 0],
          scale: [1, 1.08, 1.16],
          transition: {
            duration: 0.95,
            ease: "easeOut",
          },
        }),
      ]);

      if (cancelled || !autoLoop) return;
      // Wait, then rebuild.
      timeoutId = setTimeout(() => {
        if (!cancelled && isMountedRef.current) {
          setBuildKey((k) => k + 1);
        }
      }, loopIntervalMs - BUILD_TIME * 1000 - 950);
    };

    runSequence();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [bricksControls, shimmerControls, haloControls, autoLoop, loopIntervalMs, buildKey]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={className}
      fill="none"
      aria-label="Databricks"
      role="img"
      onMouseEnter={() => setBuildKey((k) => k + 1)}
    >
      <defs>
        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>

        <linearGradient
          id={shimmerId}
          x1="0"
          y1="0"
          x2="1"
          y2="0"
          gradientUnits="objectBoundingBox"
        >
          <stop offset="0%" stopColor="#FF7A4D" stopOpacity="0" />
          <stop offset="40%" stopColor="#FFD4B8" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="60%" stopColor="#FFD4B8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FF7A4D" stopOpacity="0" />
        </linearGradient>

        {BRICKS.map((b, i) => (
          <clipPath key={i} id={`brick-${uid}-${i}`}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} />
          </clipPath>
        ))}

        <clipPath id={`logo-${uid}`}>
          <polygon points={LOGO_POINTS} />
        </clipPath>
      </defs>

      {/* The bricks: each is a copy of the logo polygon, clipped to a tile,
          driven by variants so the parent controller can sequence them. */}
      {BRICKS.map((b, i) => {
        const delay = b.order * STAGGER;
        return (
          <motion.g
            key={i}
            clipPath={`url(#brick-${uid}-${i})`}
            initial="hidden"
            animate={bricksControls}
            variants={{
              hidden: {
                y: -VIEW_H * 0.35,
                opacity: 0,
                scale: 0.94,
                transition: { duration: 0 },
              },
              visible: {
                y: 0,
                opacity: 1,
                scale: 1,
                transition: {
                  duration: FALL_DURATION,
                  delay,
                  // A two-stage ease: drop fast, then settle with a tiny
                  // overshoot so each brick visibly "lands".
                  ease: [0.25, 1.6, 0.5, 1],
                },
              },
            }}
            style={{ transformOrigin: `${b.x + b.w / 2}px ${b.y + b.h / 2}px` }}
          >
            <polygon points={LOGO_POINTS} fill={color} />
          </motion.g>
        );
      })}

      {/* Shimmer sweep — masked to the logo silhouette. */}
      <g clipPath={`url(#logo-${uid})`}>
        <motion.rect
          x={0}
          y={0}
          width={VIEW_W * 0.6}
          height={VIEW_H}
          fill={`url(#${shimmerId})`}
          filter={`url(#${glowId})`}
          initial={{ x: -VIEW_W * 0.7, opacity: 0 }}
          animate={shimmerControls}
        />
      </g>

      {/* Halo pulse behind the assembled logo. */}
      <motion.polygon
        points={LOGO_POINTS}
        fill={color}
        initial={{ opacity: 0, scale: 1 }}
        animate={haloControls}
        style={{
          transformOrigin: `${VIEW_W / 2}px ${VIEW_H / 2}px`,
          filter: `blur(2px)`,
        }}
      />
    </svg>
  );
}

export default DatabricksAnimatedLogo;
