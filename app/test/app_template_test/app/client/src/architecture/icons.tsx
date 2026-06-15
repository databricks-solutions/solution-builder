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

/** Delta Lake — official glyph only (no wordmark) from delta.io. Brand
 *  teal triangular swoosh, sized to fit a ~24px tile. Pair with a text
 *  label if you need the full lockup. */
/** Delta Lake — official glyph only (no wordmark) from delta.io. Brand
 *  teal triangular swoosh. */
export const DeltaLogo = () => (
  <span title="Delta Lake" style={{ display: 'inline-flex', alignItems: 'center' }}>
    <svg viewBox="0 0 35 35" width={20} height={20} xmlns="http://www.w3.org/2000/svg">
      <path
        fill="#00ADD4"
        d="M34.5592717,28.0928444 L18.5379045,0.69978358 C18.1796084,0.0873136379 17.2944486,0.0873136379 16.9361525,0.69978358 L3.32065957,23.9789316 C3.08139471,24.3884473 3.51327379,24.8612058 3.94250773,24.6599347 C4.11877018,24.5769735 4.32220543,24.4935314 4.54559945,24.4103298 L4.54103057,24.4194675 C4.54103057,24.4194675 4.91303332,24.2751872 5.54161457,24.0760804 C6.23440055,23.8632669 6.99355548,23.6617554 7.68081072,23.4915046 C9.60382686,23.0476022 12.1236826,22.68618 14.3958571,23.063473 C16.4869598,23.4104672 17.9432291,23.9709962 19.0039299,24.5219066 C19.4901546,24.774878 19.9494469,24.1400447 19.5562831,23.7579423 C18.0355685,22.2800309 15.6955823,20.4960048 12.1364273,19.7483923 C11.9806046,19.7156888 11.9024528,19.5399072 11.9830093,19.40236 L17.3432635,10.2374339 C17.5195259,9.93636895 17.9545311,9.93636895 18.1307935,10.2374339 L28.3679629,27.7408004 C28.583662,28.1094366 28.4028306,28.5802714 27.9978839,28.7158949 C27.1956853,28.9840158 26.2374236,29.1845654 25.1646994,29.1845654 C24.4822535,29.1845654 23.7957197,29.1040089 23.1075026,28.9440982 C23.1070216,28.9440982 21.1236482,28.63101 18.4720165,27.0489763 C15.8203847,25.4671831 10.7078117,23.4491824 4.97098592,26.7161697 C2.52663689,28.2869014 0.897952594,30.4352353 0.0397251804,31.7840158 C-0.0946959808,31.995146 0.137354861,32.2469151 0.358103744,32.1290862 C2.32921333,31.0760804 7.64377877,28.5891687 12.4326829,29.4832257 C15.2790931,30.0144177 18.5318928,32.1632326 21.9133425,33.3953865 C27.5070903,35.4682137 32.9911852,31.9953865 33.0029681,31.987932 C33.5827345,31.6048677 33.923236,31.313662 33.9811886,31.2631639 L34.0511645,31.2020852 C34.9449811,30.4220096 35.1582755,29.1167537 34.5592717,28.0928444 Z"
      />
    </svg>
  </span>
);

/** Apache Iceberg — disc only (no wordmark) from the official Wikimedia
 *  SVG. ViewBox is cropped to the disc's bounding region (X 170..224 of
 *  the original 224-wide lockup). All 17 disc paths kept; wordmark paths
 *  (X < 170) dropped. */
export const IcebergLogo = () => (
  <span title="Apache Iceberg" style={{ display: 'inline-flex', alignItems: 'center' }}>
    <svg viewBox="170 -2 56 56" width={22} height={22} xmlns="http://www.w3.org/2000/svg" fill="none">
      <path d="M219.858 12.0673C221.827 14.267 222.7 17.0055 223.325 19.7648C226.537 33.9756 217.996 47.6386 203.764 50.6969C188.21 54.0394 174.997 43.177 173.013 29.5702C172.134 23.9752 173.141 18.2467 175.876 13.2871C176.128 12.8222 176.293 12.2657 176.877 12.0584L184.222 12.1798L181.717 17.4763C181.717 17.6579 181.717 17.8394 181.717 18.021C183.526 23.2701 186.898 27.5837 190.098 31.9979C190.442 33.8719 190.187 35.8466 191.022 37.6378C193.355 40.2727 195.687 42.9096 198.018 45.5484C198.19 45.7438 198.397 45.8682 198.61 45.5781C199.676 44.9267 199.987 43.7307 200.576 42.7566C201.914 40.554 203.368 38.4105 204.425 36.045L204.75 35.5299C206.059 35.0206 206.885 33.8483 208.043 33.1348C208.43 32.9221 208.746 32.6001 208.952 32.209C209.158 31.8179 209.244 31.3748 209.2 30.935C209.132 28.7235 209.176 26.4942 209.173 24.2915C209.698 23.7726 210.192 23.224 210.654 22.6484C211.782 21.0645 213.558 19.9839 214.221 18.0477C214.338 18.0629 214.457 18.0429 214.563 17.9901C214.668 17.9374 214.755 17.8543 214.813 17.7516C215.281 17.0411 214.778 16.446 214.574 15.8213C214.183 14.6193 213.434 13.5357 213.357 12.2272L219.858 12.0673Z" fill="#287ABE" />
      <path d="M184.225 12.1798L176.88 12.0584C177.848 9.53897 179.763 7.73598 181.741 6.07806C185.145 3.22111 189.05 1.24936 193.459 0.452969C201.127 -0.911856 208.102 0.749027 214.275 5.52739C216.575 7.30374 218.662 9.31693 219.864 12.0584L213.351 12.2005L208.022 12.1354V10.3383L211.841 10.3176L211.965 10.2495L211.844 10.0482C211.201 9.41788 210.433 8.92919 209.589 8.61357C208.746 8.29794 207.846 8.16238 206.947 8.2156C201.695 8.33994 196.44 8.26593 191.188 8.25408C189.346 8.25408 187.813 9.0416 186.336 10.0156C184.974 10.0748 184.95 11.2383 184.598 12.1265L184.225 12.1798Z" fill="#B8E1F2" />
      <path d="M181.717 18.0151C181.717 17.8335 181.717 17.6519 181.717 17.4704C184.787 16.5585 187.606 15.0427 190.495 13.7104C191.41 13.2871 192.671 13.3226 193.16 12.1502C194.918 12.2242 196.712 11.8541 198.438 12.3811C198.452 16.5259 198.466 20.6806 198.48 24.8451H198.208C194.835 23.4033 191.487 21.9053 188.085 20.5405C185.974 19.7026 184.041 18.3644 181.717 18.0151Z" fill="#B6E0F2" />
      <path d="M181.717 18.0151C184.038 18.3615 185.971 19.6967 188.094 20.5494C191.496 21.9142 194.844 23.4122 198.216 24.854C197.947 26.1182 196.695 26.4202 195.907 27.1633C194.11 28.8626 191.961 30.1564 190.247 31.9594C190.2 31.9806 190.15 31.9927 190.099 31.9949C186.901 27.5807 183.529 23.2701 181.717 18.0151Z" fill="#90D4F0" />
      <path d="M209.176 24.2797C209.176 26.4942 209.135 28.7205 209.203 30.9232C209.247 31.363 209.161 31.806 208.955 32.1971C208.749 32.5883 208.433 32.9102 208.046 33.1229C206.888 33.8364 206.062 35.0088 204.753 35.518C203.356 33.7417 202.486 31.6219 201.233 29.7567C200.381 28.4896 200.028 26.8554 198.569 26.0264C198.569 25.7461 198.574 25.4659 198.584 25.1856L199.149 24.8895C199.404 25.2034 199.762 25.1619 200.093 25.1323C203.115 24.856 206.143 24.5718 209.176 24.2797Z" fill="#4D8AC8" />
      <path d="M191.022 37.6407C190.187 35.8466 190.43 33.8749 190.101 31.9979C190.153 31.9956 190.203 31.9836 190.249 31.9624C192.914 32.0749 195.578 32.143 198.225 32.5545C198.225 34.6269 198.22 36.6993 198.21 38.7717C197.676 38.751 197.144 38.6936 196.618 38.6C194.747 38.3098 192.941 37.6467 191.022 37.6407Z" fill="#B6E0F2" />
      <path d="M198.208 38.7687C198.208 36.6963 198.212 34.6239 198.222 32.5515C198.835 30.4021 198.317 28.1936 198.557 26.0383C200.019 26.8672 200.375 28.5044 201.221 29.7686C202.477 31.6367 203.344 33.7446 204.742 35.5299L204.416 36.045L198.462 38.7835C198.377 38.787 198.292 38.7821 198.208 38.7687Z" fill="#58AFDD" />
      <path d="M208.007 12.1443L213.336 12.2094C213.413 13.518 214.162 14.6016 214.553 15.8036C214.757 16.4312 215.26 17.0233 214.793 17.7338C214.676 17.7245 214.56 17.7471 214.455 17.7993C214.351 17.8515 214.263 17.9312 214.2 18.0299C213.09 18.2371 212.128 18.8263 211.124 19.2763C210.121 19.7263 209.23 20.4783 208.042 20.4457C208.042 17.6983 208.038 14.9519 208.028 12.2065L208.007 12.1443Z" fill="#4D8AC8" />
      <path d="M208.048 20.4487C209.233 20.4813 210.121 19.7263 211.13 19.2793C212.14 18.8322 213.096 18.2401 214.206 18.0329C213.54 19.972 211.767 21.0497 210.639 22.6336C210.177 23.2092 209.683 23.7578 209.159 24.2767C206.129 24.5629 203.099 24.8481 200.07 25.1323C199.738 25.1619 199.38 25.2034 199.125 24.8896C201.218 23.9214 203.326 22.9859 205.396 21.9704C206.313 21.5263 207.376 21.3161 208.048 20.4487Z" fill="#266FA8" />
      <path d="M198.208 38.7687C198.295 38.7778 198.383 38.7778 198.471 38.7687C198.518 41.0346 198.565 43.3043 198.61 45.578C198.397 45.8741 198.193 45.7409 198.018 45.5484C195.683 42.9175 193.351 40.2845 191.022 37.6496C192.938 37.6496 194.744 38.3187 196.615 38.6089C197.141 38.6985 197.674 38.7519 198.208 38.7687Z" fill="#90D4F0" />
      <path d="M193.172 12.1561C192.671 13.3404 191.41 13.293 190.507 13.7163C187.618 15.0486 184.799 16.5644 181.729 17.4763L184.237 12.1798L184.604 12.1324L193.172 12.1561Z" fill="#90D4F0" />
      <path d="M198.607 45.5692C198.562 43.3033 198.515 41.0336 198.468 38.7598L204.422 36.0213C203.365 38.3898 201.911 40.5303 200.573 42.7329C199.999 43.7188 199.673 44.9149 198.607 45.5692Z" fill="#266FA8" />
      <path d="M214.209 18.0388C214.272 17.9401 214.36 17.8604 214.464 17.8082C214.569 17.756 214.685 17.7334 214.802 17.7427C214.744 17.8454 214.656 17.9285 214.551 17.9812C214.445 18.034 214.326 18.054 214.209 18.0388Z" fill="#266FA8" />
      <path d="M186.327 10.0215C187.807 9.04752 189.338 8.2452 191.179 8.26001C196.434 8.26001 201.689 8.34586 206.938 8.22152C207.838 8.16785 208.74 8.30347 209.584 8.61963C210.429 8.93579 211.197 9.42547 211.841 10.0571C211.841 10.1479 211.841 10.2387 211.841 10.3294L207.992 10.3502H188.186C187.547 10.3502 186.901 10.3887 186.327 10.0215Z" fill="#F4FAFD" />
      <path d="M186.327 10.0215C186.901 10.3887 187.547 10.3472 188.186 10.3472H207.992V12.1443L208.016 12.2094L198.45 12.39C196.709 11.866 194.93 12.2331 193.172 12.1591L184.586 12.1384C184.944 11.2443 184.965 10.0808 186.327 10.0215Z" fill="#E9F6FD" />
      <path d="M211.841 10.3176C211.841 10.2268 211.841 10.136 211.841 10.0452L211.962 10.2465L211.841 10.3176Z" fill="#E9F6FD" />
      <path d="M198.45 12.39L208.034 12.2153C208.034 14.9627 208.039 17.7092 208.048 20.4546C207.376 21.3221 206.316 21.5323 205.408 21.9793C203.335 22.9948 201.23 23.9303 199.137 24.8984L198.572 25.1945L198.492 24.8599L198.45 12.39Z" fill="#68C1EA" />
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
