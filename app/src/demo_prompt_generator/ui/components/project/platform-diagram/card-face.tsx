/**
 * platform-diagram/card-face — the drawn face of a `card` annotation and the
 * corner badge shared with a box. Pure presentation: every size comes from
 * `cardLayout` (lib/platform-architecture), so the rendered card and the box the
 * layout reserves are the same by construction. The icon is passed in as a node
 * (not imported here) so this module doesn't depend on annotations.tsx.
 *
 * Nothing in here ellipsizes: every text block wraps, and each is `overflow:hidden`
 * at its measured height, so an underestimated line count shows up as
 * scrollHeight > clientHeight — the CLIPPED TEXT check in inspect-arch.
 */
import type { AnnotationData, CardLayout } from "@/lib/platform-architecture";
import { CARD_BADGE_COLOR, CARD_BODY_FONT, CARD_ICON, CARD_NEUTRAL_BORDER, CARD_TITLE_COLOR, softBreakPieces } from "@/lib/platform-architecture";
import { cardBodySource, sanitizeDiagramHtml } from "@/lib/card-body";

const PAD_X = 12;
const BODY_INK = "#0F172A";

/** Card text with a `<wbr>` after each soft-break point of a long identifier
 *  (`reporting.gold_v3_staging` breaks after `.` and `_` before it breaks inside a
 *  piece). A word that already fits renders as plain text. The points are the same
 *  pieces `cardLayout`'s soft wrap measures (softBreakPieces). */
export function SoftText({ text }: { text?: string }) {
  if (!text) return null;
  const out: React.ReactNode[] = [];
  text.split(/(\s+)/).forEach((seg, i) => {
    if (!seg) return;
    if (/^\s+$/.test(seg)) { out.push(seg); return; }
    softBreakPieces(seg).forEach((p, j) => {
      if (j > 0) out.push(<wbr key={`${i}-${j}`} />);
      out.push(p);
    });
  });
  return <>{out}</>;
}

/** Small dark pill overlapping a corner (top-right by default). Used by cards and
 *  boxes. The badge is absolutely placed, so it never changes the box geometry;
 *  a card's header reserves room for it instead (`layout.badgeW`). */
export function CornerBadge({ text, color }: { text: string; color?: string }) {
  return (
    <span
      className="pointer-events-none absolute whitespace-nowrap rounded-full px-2 font-bold text-white"
      style={{
        top: -9,
        right: 10,
        height: 18,
        lineHeight: "18px",
        fontSize: 10,
        letterSpacing: "0.03em",
        background: color || CARD_BADGE_COLOR,
        boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
      }}
    >
      {text}
    </span>
  );
}

/** The card's face. `icon` is the rendered header icon (or undefined). `layout`
 * comes from `cardLayout(a, {w, h})` — the caller passes the SAME layout it used to size
 * the ReactFlow box. `border` carries the node's border overrides (`style.border` width,
 * `style.borderStyle`, `style.radius`); unset keeps the default 1.5px solid accent border
 * and 10px corners. `titleSlot` replaces the title text (the inline title editor). The
 * body is the card's HTML, passed through sanitizeDiagramHtml before it reaches the DOM. */
export function CardFace({ a, layout, icon, border, titleSlot }: {
  a: AnnotationData;
  layout: CardLayout;
  icon?: React.ReactNode;
  border?: { width?: number; style?: "solid" | "dashed"; radius?: number };
  titleSlot?: React.ReactNode;
}) {
  const accent = a.accent || CARD_NEUTRAL_BORDER;
  // Ink: an explicit title colour wins; `textColor` is the card-wide ink (title + body).
  const titleColor = a.titleColor || a.textColor || CARD_TITLE_COLOR;
  const bodyColor = a.textColor || BODY_INK;
  // A whole-card fill replaces the white body AND the header tint.
  const fill = a.fill || undefined;
  const headerTint = fill ?? (a.accent ? `color-mix(in srgb, ${a.accent} 14%, white)` : "#F1F5F9");
  const badgeText = a.badge?.trim() ? a.badge : "";
  const borderW = border?.width ?? 1.5;
  const outer = {
    boxSizing: "border-box" as const,
    border: borderW > 0 ? `${borderW}px ${border?.style ?? "solid"} ${accent}` : "none",
    boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
    ...(fill ? { background: fill } : {}),
    ...(border?.radius !== undefined ? { borderRadius: border.radius } : {}),
  };
  // Header corners follow a custom radius (one px inside the outer rounding).
  const headerRadius = border?.radius !== undefined
    ? { borderTopLeftRadius: Math.max(0, border.radius - 1), borderTopRightRadius: Math.max(0, border.radius - 1) }
    : {};
  const surface = `relative flex h-full w-full flex-col rounded-[10px] ${fill ? "" : "bg-white"}`;
  const title = titleSlot ?? <SoftText text={a.title} />;

  // Title-only: a centred label. No header band, no divider — the icon + title sit
  // in the middle of the whole card, so it reads as one labelled box.
  if (layout.centered) {
    return (
      <div className={surface} style={outer}>
        <div
          className="flex min-h-0 flex-1 items-center justify-center"
          style={{ padding: `${layout.bodyPadY}px ${layout.padX}px`, boxSizing: "border-box", gap: 8 }}
        >
          {icon && (
            <span className="grid shrink-0 place-items-center" style={{ width: CARD_ICON, height: CARD_ICON }}>
              {icon}
            </span>
          )}
          <div
            className="min-w-0 overflow-hidden text-center"
            style={{ height: layout.titleH, fontSize: layout.titleFont, fontWeight: 500, lineHeight: 1.25, color: titleColor, overflowWrap: "anywhere" }}
          >
            {title}
          </div>
        </div>
        {badgeText && <CornerBadge text={badgeText} color={a.badgeColor} />}
      </div>
    );
  }

  const hasHeader = layout.headerH > 0;
  const hasBody = layout.bodyH > 0;
  return (
    <div className={surface} style={outer}>
      {hasHeader && (
        <div
          className="flex items-start gap-2 rounded-t-[9px]"
          style={{
            height: layout.headerH,
            boxSizing: "border-box",
            ...headerRadius,
            padding: `8px ${layout.badgeW ? layout.badgeW + 10 : PAD_X}px 8px ${PAD_X}px`,
            background: headerTint,
            borderBottom: `1px solid ${accent}`,
          }}
        >
          {icon && (
            <span className="grid shrink-0 place-items-center" style={{ width: CARD_ICON, height: CARD_ICON }}>
              {icon}
            </span>
          )}
          <div
            className="min-w-0 flex-1 overflow-hidden font-bold"
            style={{ height: layout.titleH, fontSize: layout.titleFont, lineHeight: 1.25, color: titleColor, overflowWrap: "anywhere" }}
          >
            {title}
          </div>
        </div>
      )}
      {hasBody && (
        // The HTML body. Paragraph / list margins are zeroed (the height estimate
        // does not budget them); the section is exactly the measured height.
        <div
          className="overflow-hidden [&_ol]:m-0 [&_ol]:pl-4 [&_p]:m-0 [&_table]:border-collapse [&_ul]:m-0 [&_ul]:pl-4"
          style={{
            height: layout.bodyH,
            boxSizing: "border-box",
            padding: `${layout.bodyPadY}px ${PAD_X}px`,
            fontSize: CARD_BODY_FONT,
            lineHeight: 1.35,
            color: bodyColor,
            overflowWrap: "anywhere",
          }}
          dangerouslySetInnerHTML={{ __html: sanitizeDiagramHtml(cardBodySource(a)) }}
        />
      )}
      {badgeText && <CornerBadge text={badgeText} color={a.badgeColor} />}
    </div>
  );
}
