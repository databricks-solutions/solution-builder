/**
 * Databricks product icons — two-tone SVG (SOLID / LIGHT) matching the
 * official Data + AI Platform slide tiles. Each is a self-contained <svg>
 * with viewBox="0 0 48 48" (chip icons use 24×24) so callers control size
 * via a wrapper div.
 *
 * Reference set (kept complete even if some aren't used yet) — anything on
 * the official Databricks platform slide that might land in a future panel:
 *
 *   Products (48×48, two-tone):
 *     GenieIcon · GenieOntologyIcon · AgentBricksIcon · UCIcon · GatewayIcon
 *     LakeflowIcon · LakehouseIcon · LakebaseIcon · AIBIIcon · AppsIcon
 *
 *   Bolts / badges / glyphs:
 *     ZerobusBolt · RtBadge · ScanIcon · DeltaLogo · IcebergLogo · TableGlyph
 *
 *   Agentic Work chips (24×24):
 *     OneIcon · AgentsIcon · CodeIcon
 *
 *   Parametric line icons:
 *     SrcIcon + SRC path map
 *
 * Currently used by IngestionFlow / AgentLoopFlow / RtPitch.
 */

export const SOLID = '#EF5B3F';
export const LIGHT = '#F5C5BC';

export const GenieIcon = () => (
  <svg viewBox="0 0 48 48">
    {/* 4-point sparkle, long lower point reaching the lamp lid */}
    <path
      fill={SOLID}
      d="M25 2 C25.8 7.5 27.5 9.3 32.5 10.2 C27.5 11.1 25.8 13.4 25 22 C24.2 13.4 22.5 11.1 17.5 10.2 C22.5 9.3 24.2 7.5 25 2 Z"
    />
    <path
      fill={LIGHT}
      d="M11 28.5 C9.8 32.8 12.8 36.4 17.5 37.4 L27.5 37.4 C33 36.8 36.4 33.6 37.6 30 C38.6 26.9 40.8 24.3 44.2 22.4 C45 22 44.9 20.9 44 20.7 C40.4 20 37.1 21.3 34.9 23.6 C32.4 22.6 29.2 22.6 26.7 23.6 L17 23.6 C13.8 23.7 11.8 25.4 11 28.5 Z"
    />
    <path
      fill={LIGHT}
      d="M11.5 28 C6 27.6 4.8 33.4 9.6 35.4 C7.6 33.2 8.2 30.2 11.6 29.6 Z"
    />
    <path
      fill={SOLID}
      d="M18.5 39.5 H30.5 C31.4 39.5 32.2 40 32.6 40.8 L33.5 42.6 C33.9 43.4 33.3 44.3 32.4 44.3 H16.6 C15.7 44.3 15.1 43.4 15.5 42.6 L16.4 40.8 C16.8 40 17.6 39.5 18.5 39.5 Z"
    />
  </svg>
);

/** Genie + a small 3-node ontology graph above the lamp instead of a sparkle. */
export const GenieOntologyIcon = () => (
  <svg viewBox="0 0 48 48">
    <path
      stroke={SOLID}
      strokeWidth="1.6"
      fill="none"
      strokeLinecap="round"
      d="M25 4.5 L17.5 11 M25 4.5 L32 12 M17.5 11 L32 12 M25 4.5 L25 17"
    />
    <circle cx="25" cy="4.5" r="2.8" fill={SOLID} />
    <circle cx="17.5" cy="11" r="2.4" fill={SOLID} />
    <circle cx="32" cy="12" r="2.4" fill={SOLID} />
    <path
      fill={LIGHT}
      d="M11 28.5 C9.8 32.8 12.8 36.4 17.5 37.4 L27.5 37.4 C33 36.8 36.4 33.6 37.6 30 C38.6 26.9 40.8 24.3 44.2 22.4 C45 22 44.9 20.9 44 20.7 C40.4 20 37.1 21.3 34.9 23.6 C32.4 22.6 29.2 22.6 26.7 23.6 L17 23.6 C13.8 23.7 11.8 25.4 11 28.5 Z"
    />
    <path
      fill={LIGHT}
      d="M11.5 28 C6 27.6 4.8 33.4 9.6 35.4 C7.6 33.2 8.2 30.2 11.6 29.6 Z"
    />
    <path
      fill={SOLID}
      d="M18.5 39.5 H30.5 C31.4 39.5 32.2 40 32.6 40.8 L33.5 42.6 C33.9 43.4 33.3 44.3 32.4 44.3 H16.6 C15.7 44.3 15.1 43.4 15.5 42.6 L16.4 40.8 C16.8 40 17.6 39.5 18.5 39.5 Z"
    />
  </svg>
);

/** Four bricks; touching at corners. */
export const AgentBricksIcon = () => (
  <svg viewBox="0 0 48 48">
    <rect x="24" y="3.5" width="18" height="10.5" fill={LIGHT} />
    <rect x="6" y="14" width="18" height="10.5" fill={SOLID} />
    <rect x="24" y="24.5" width="18" height="10.5" fill={LIGHT} />
    <rect x="6" y="35" width="18" height="10.5" fill={SOLID} />
  </svg>
);

/** UC rosette: 12-piece ring around a solid hexagon. */
export const UCIcon = () => {
  const cx = 24;
  const cy = 24;
  const r = 16.5;
  const items: React.ReactNode[] = [];
  for (let k = 0; k < 12; k++) {
    const deg = k * 30;
    const a = (deg * Math.PI) / 180;
    const x = cx + r * Math.cos(a);
    const y = cy - r * Math.sin(a);
    if (k % 2 === 1) {
      const rot = 270 - deg;
      items.push(
        <path
          key={k}
          fill={SOLID}
          transform={`rotate(${rot} ${x} ${y})`}
          d={`M${x - 4} ${y + 3.1} L${x + 4} ${y + 3.1} L${x} ${y - 3.8} Z`}
        />,
      );
    } else if (k === 0 || k === 6) {
      items.push(
        <rect key={k} x={x - 4} y={y - 4} width="8" height="8" fill={LIGHT} />,
      );
    } else {
      items.push(
        <rect
          key={k}
          x={x - 4}
          y={y - 4}
          width="8"
          height="8"
          fill={LIGHT}
          transform={`rotate(${-deg} ${x} ${y})`}
        />,
      );
    }
  }
  return (
    <svg viewBox="0 0 48 48">
      {items}
      <path fill={SOLID} d="M24 14.8 L32 19.4 V28.6 L24 33.2 L16 28.6 V19.4 Z" />
    </svg>
  );
};

/** AI Gateway: siren-dome plus a 4-square arc. */
export const GatewayIcon = () => {
  const cx = 24;
  const cy = 27.5;
  const r = 15;
  const sq = [0, 60, 120, 180].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const x = cx + r * Math.cos(a);
    const y = cy - r * Math.sin(a);
    return (
      <rect
        key={deg}
        x={x - 3.8}
        y={y - 3.8}
        width="7.6"
        height="7.6"
        fill={LIGHT}
        transform={`rotate(${-deg} ${x} ${y})`}
      />
    );
  });
  return (
    <svg viewBox="0 0 48 48">
      {sq}
      <path fill={SOLID} d="M16.5 36.5 V26 a7.5 7.5 0 0 1 15 0 V36.5 Z" />
      <path fill={LIGHT} d="M12 44.5 L36 44.5 L31.5 38.5 L16.5 38.5 Z" />
    </svg>
  );
};

export const LakeflowIcon = () => (
  <svg viewBox="0 0 48 48">
    <path fill={LIGHT} d="M6 10 H21 L30.5 20 H42 V28 H27.5 L18 18 H6 Z" />
    <path fill={SOLID} d="M6 23 H18.5 L28 33 H42 V41 H24.5 L15 31 H6 Z" />
  </svg>
);

/** Databricks Apps — 4-tile glyph from the official slide. */
export const AppsIcon = () => (
  <svg viewBox="0 0 48 48">
    <rect x="9"  y="9"  width="13" height="13" rx="2.5" fill={LIGHT} />
    <rect x="26" y="9"  width="13" height="13" rx="2.5" fill={SOLID} />
    <rect x="9"  y="26" width="13" height="13" rx="2.5" fill={SOLID} />
    <rect x="26" y="26" width="13" height="13" rx="2.5" fill={LIGHT} />
  </svg>
);

export const LakehouseIcon = () => (
  <svg viewBox="0 0 48 48">
    <path
      fill={LIGHT}
      d="M10 19 L24 6.5 L38 19 V25.2 C35.5 26.4 32.5 28.4 29.5 28.8 C26 29.2 23.5 28.1 20 26.4 C17 24.8 13 24.8 10 27 Z"
    />
    <path
      fill={SOLID}
      d="M10 32.5 C13 30.3 17 30.3 20 31.9 C23.5 33.6 26 34.7 29.5 34.3 C32.5 33.9 35.5 31.9 38 30.7 V38.2 C35.5 39.4 32.5 41.4 29.5 41.8 C26 42.2 23.5 41.1 20 39.4 C17 37.8 13 37.8 10 40 Z"
    />
  </svg>
);

export const LakebaseIcon = () => (
  <svg viewBox="0 0 48 48">
    <rect x="10" y="6.5" width="28" height="9" fill={LIGHT} />
    <path
      fill={LIGHT}
      d="M10 18.5 H38 V25.7 C35.5 26.9 32.5 28.9 29.5 29.3 C26 29.7 23.5 28.6 20 26.9 C17 25.3 13 25.3 10 27.5 Z"
    />
    <path
      fill={SOLID}
      d="M10 33 C13 30.8 17 30.8 20 32.4 C23.5 34.1 26 35.2 29.5 34.8 C32.5 34.4 35.5 32.4 38 31.2 V41.5 H10 Z"
    />
  </svg>
);

export const AIBIIcon = () => (
  <svg viewBox="0 0 48 48">
    <path
      fill={SOLID}
      d="M25.5 7 a17 17 0 0 1 0 34 V32.5 a8.5 8.5 0 0 0 0-17 Z"
    />
    <path
      fill={LIGHT}
      d="M22.5 8.5 a15.5 15.5 0 0 0-15.5 15.5 H22.5 Z"
    />
    <path
      fill={LIGHT}
      d="M1.5 27 a21 21 0 0 0 21 21 V39.5 a12.5 12.5 0 0 1-12.5-12.5 Z"
    />
  </svg>
);

/** Zerobus bolt — used inline at currentColor; wrap to tint red. */
export const ZerobusBolt = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
  </svg>
);

/** Small ⚡RT badge — used as a chip next to Lakehouse. */
export function RtBadge() {
  return (
    <span
      title="Lakehouse — Real-Time"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        marginLeft: 6,
        padding: '2px 5px',
        borderRadius: 4,
        background: SOLID,
        color: '#fff',
        font: '700 9px/1 "DM Mono", monospace',
        letterSpacing: '0.05em',
        verticalAlign: 'middle',
      }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" width="9" height="9">
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
      </svg>
      RT
    </span>
  );
}

/** Small scanner-style icon used as the "source" node in the ingestion strip. */
export const ScanIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke={SOLID}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />
  </svg>
);

/* ───────── Agentic Work chip icons (24×24) — kept for future panels ────── */

/** Solid hexagon with a white "1" — the Agent Bricks "ONE" chip glyph. */
export const OneIcon = () => (
  <svg viewBox="0 0 24 24">
    <path fill={SOLID} d="M12 1.8 21 6.9v10.2L12 22.2 3 17.1V6.9Z" />
    <text
      x="11.4"
      y="16.6"
      textAnchor="middle"
      fontSize="12"
      fontWeight="800"
      fill="#fff"
      fontFamily="DM Sans, sans-serif"
    >
      1
    </text>
  </svg>
);

/** Fat 4-point star — the Agentic "agents" chip glyph. */
export const AgentsIcon = () => (
  <svg viewBox="0 0 24 24">
    <path
      fill={SOLID}
      d="M12 2.8 C13.5 8 15 9.5 20.2 11 C15 12.5 13.5 14 12 19.2 C10.5 14 9 12.5 3.8 11 C9 9.5 10.5 8 12 2.8 Z"
    />
  </svg>
);

/** Angle brackets — the "code" chip glyph. */
export const CodeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke={SOLID}
    strokeWidth={4}
    strokeLinecap="butt"
    strokeLinejoin="miter"
  >
    <path d="M9 5.5 3.5 12 9 18.5M15 5.5 20.5 12 15 18.5" />
  </svg>
);

/* ───────── Parametric line icon for sources (kept for future panels) ──── */

/** Generic line-icon factory used as a "source" node (per-event datasources
 *  like scanner / bet / pdf / odds). Pass one of the SRC path constants. */
export const SrcIcon = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke={SOLID}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

/** Path map for SrcIcon. Add new entries as new source flavours arrive. */
export const SRC = {
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
  bet:  'M4 6h16M4 12h10M4 18h13M19.5 10.5 22 12l-2.5 1.5z',
  pdf:  'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 14h6M9 17h4',
  odds: 'M4 20V11M10 20V4M16 20V14M21 20H3',
};

/* ───────── Storage format logos (kept for future panels) ────────────────── */

/** Delta Lake lockup — brand teal triangle + dark inset. */
export const DeltaLogo = () => (
  <span
    title="Delta Lake"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      font: '700 10px/1 "DM Mono", monospace',
      letterSpacing: '0.08em',
      color: '#20B5D8',
    }}
  >
    <svg viewBox="0 0 48 48" width={18} height={18}>
      <path fill="#20B5D8" d="M24 4 43 42 H5 Z" />
      <path fill="#0B2026" d="M24 14.5 35.5 38 H12.5 Z" opacity=".85" />
    </svg>
    DELTA LAKE
  </span>
);

/** Apache Iceberg lockup — blue disc + white inset peaks. */
export const IcebergLogo = () => (
  <span
    title="Apache Iceberg"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      font: '700 10px/1 "DM Mono", monospace',
      letterSpacing: '0.08em',
      color: '#4C8FE8',
    }}
  >
    ICEBERG
    <svg viewBox="0 0 48 48" width={18} height={18}>
      <circle cx="24" cy="24" r="20" fill="#4C8FE8" />
      <path fill="#fff" d="M14 32 19 18 24 26 28 14 34 32 Z" />
    </svg>
  </span>
);

/** Small generic Delta-style table glyph used in storyboard panels. */
export const TableGlyph = () => (
  <svg width="44" height="38" viewBox="0 0 44 38">
    <rect x="1" y="1" width="42" height="36" rx="6" fill="#fff" />
    <rect x="5" y="5.5" width="34" height="6.5" rx="2" fill={SOLID} />
    <rect x="5" y="15" width="34" height="5.5" rx="1.5" fill={LIGHT} />
    <rect x="5" y="23.5" width="34" height="5.5" rx="1.5" fill={LIGHT} opacity=".65" />
  </svg>
);
