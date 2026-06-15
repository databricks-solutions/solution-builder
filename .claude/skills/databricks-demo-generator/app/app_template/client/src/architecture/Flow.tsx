/**
 * Reusable flow primitives in the LIVE GATE INGESTION / OPS AGENT LOOP style:
 *
 *   <Stage icon name sub /> ── <Connector /> ── <Stage … /> …
 *
 * - Stage    : white tile (44×44) with a 30×30 icon centered, plus a
 *              one-line `name` (DM Sans, bold) and a `sub` line (DM Mono).
 * - Connector: a thin grey line with a red dot animating along it toward
 *              the next stage (continuous loop, ~2s).
 *
 * Inline styles are used (this codebase has no per-component CSS module);
 * the keyframe animation is registered once via a shared <style> block
 * rendered by <FlowKeyframes/>.
 */

export function FlowKeyframes() {
  return (
    <style>{`
      @keyframes db-flow-dot { 0% { transform: translateX(0); opacity: 0 } 12% { opacity: 1 } 88% { opacity: 1 } 100% { transform: translateX(var(--db-flow-w, 48px)); opacity: 0 } }
      .db-flow-dot-animate { animation: db-flow-dot 2s linear infinite; fill: #EF5B3F; filter: drop-shadow(0 0 4px #EF5B3F); }
      /* Fork dots use SVG <animateMotion> (not CSS offset-path) so they
         ride the same <path> element the trunk renders — coordinates can
         never drift. The fade is a separate CSS keyframe on opacity. */
      @keyframes db-fork-fade { 0% { opacity: 0 } 12% { opacity: 1 } 88% { opacity: 1 } 100% { opacity: 0 } }
      .db-fork-dot { fill: #EF5B3F; filter: drop-shadow(0 0 4px #EF5B3F);
        animation: db-fork-fade 2s linear infinite; }
    `}</style>
  );
}

export function Stage({
  icon,
  name,
  sub,
  tileSize = 44,
  iconSize = 30,
  bare = false,
}: {
  icon: React.ReactNode;
  name: string;
  sub?: string;
  tileSize?: number;
  iconSize?: number;
  /** When true, render the icon WITHOUT a white tile background. Used by
   *  bespoke "raw event" glyphs (e.g. the IngestionFlow "Data" node) that
   *  should read as unstructured input, not a product logo. */
  bare?: boolean;
}) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: tileSize,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: tileSize,
          height: tileSize,
          borderRadius: bare ? 0 : 11,
          background: bare ? 'transparent' : '#fff',
          display: 'grid',
          placeItems: 'center',
          boxShadow: bare ? 'none' : '0 2px 10px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ width: iconSize, height: iconSize }}>{icon}</div>
      </div>
      <div
        style={{
          position: 'absolute',
          top: `calc(100% + 7px)`,
          left: '50%',
          transform: 'translateX(-50%)',
          whiteSpace: 'nowrap',
          textAlign: 'center',
          font: '700 12px/1 "DM Sans", sans-serif',
          color: 'var(--foreground)',
        }}
      >
        {name}
      </div>
      {sub && (
        <div
          style={{
            position: 'absolute',
            top: `calc(100% + 23px)`,
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            textAlign: 'center',
            font: '500 10px/1 "DM Mono", monospace',
            letterSpacing: '0.02em',
            color: 'var(--muted-foreground)',
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/** Fork connector: trunk on the left, splits into two bezier branches that
 *  rise to a top tile (y≈22) and drop to a bottom tile (y≈108) in a 72×130
 *  fan. Pair with a vertically-stacked pair of <Stage> nodes on the right.
 *
 *  Each branch is drawn as its own <path>; the riding dot uses
 *  <animateMotion><mpath/></animateMotion> to follow that exact path
 *  element — coordinates are shared by reference, not by string, so the
 *  dot can never drift off the curve. */
export function Fork() {
  return (
    <span
      aria-hidden
      style={{
        width: 72,
        height: 130,
        flexShrink: 0,
        alignSelf: 'center',
      }}
    >
      <svg viewBox="0 0 72 130" width={72} height={130} style={{ overflow: 'visible' }}>
        {/* Trunk + upper branch as ONE continuous path so a single
            animateMotion runs from trunk start (x=0) to upper branch end. */}
        <path
          id="db-fork-path-up"
          d="M0 65 C30 65 50 22 72 22"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1.4}
          opacity={0.5}
        />
        {/* Lower branch shares the same trunk start (0,65) and dives down. */}
        <path
          id="db-fork-path-down"
          d="M0 65 C30 65 50 108 72 108"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1.4}
          opacity={0.5}
        />
        <circle className="db-fork-dot" r={2.4}>
          <animateMotion dur="2s" repeatCount="indefinite">
            <mpath href="#db-fork-path-up" />
          </animateMotion>
        </circle>
        <circle className="db-fork-dot" r={2.4}>
          <animateMotion dur="2s" repeatCount="indefinite">
            <mpath href="#db-fork-path-down" />
          </animateMotion>
        </circle>
      </svg>
    </span>
  );
}

/** Thin grey line + animated red dot. Width defaults to 48px.
 *  Two positioning modes:
 *   - default: connector locks to `flex-start` and is pushed down 18px,
 *     which lands it on the centerline of a 44px <Stage> tile when the
 *     parent uses `items-start` (IngestionFlow / RtPitch).
 *   - `centered`: connector inherits parent flex `align-items` (e.g.
 *     `items-center`), so it vertically centers against the tallest row
 *     child. Used by AgentLoopFlow where the row also contains a much
 *     taller analysis box. */
export function Connector({
  width = 48,
  marginTop = 18,
  centered = false,
}: {
  width?: number;
  marginTop?: number;
  centered?: boolean;
}) {
  return (
    <span
      aria-hidden
      style={{
        width,
        height: 8,
        flexShrink: 0,
        alignSelf: centered ? undefined : 'flex-start',
        marginTop: centered ? undefined : marginTop,
        ['--db-flow-w' as string]: `${width}px`,
      }}
    >
      <svg
        viewBox={`0 0 ${width} 8`}
        preserveAspectRatio="none"
        width={width}
        height={8}
        style={{ overflow: 'visible' }}
      >
        <line
          x1="0"
          y1="4"
          x2={width}
          y2="4"
          style={{ stroke: 'var(--muted-foreground)', strokeWidth: 1.4, opacity: 0.5 }}
        />
        <circle className="db-flow-dot-animate" cx="0" cy="4" r="2.4" />
      </svg>
    </span>
  );
}
