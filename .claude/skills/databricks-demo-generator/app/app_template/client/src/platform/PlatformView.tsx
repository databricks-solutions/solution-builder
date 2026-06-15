/**
 * Databricks Data + AI — the platform pitch page.
 *
 * Visual storytelling: each layer is a wide row with an animated scene on
 * the LEFT (alternating to the right) and the pitch + capability list on
 * the other side. Scenes are pure SVG + lucide-react icons, with CSS/SVG
 * motion (no framer-motion).
 *
 * Layers:
 *   1. Ingest + Transform — sources → declarative pipeline
 *      (also hosts a compact "Built with Genie Code" strip)
 *   2. Govern + Define     — Unity Catalog as the spine
 *   3. Speak to your data  — Dashboards + Genie + Agent Bricks
 *   4. Act                 — Lakebase + Apps reaching the operator
 */

import { useState, type ReactElement } from 'react';
import {
  ChevronDown,
  ExternalLink,
  Database,
  AppWindow,
  Sparkles,
  ShieldCheck,
  Gauge,
  Workflow,
  Cable,
  BarChart3,
  BookOpen,
  Network,
  Cloud,
  Box,
  HardDrive,
  Activity,
  Server,
  Code2,
  MessagesSquare,
  type LucideIcon,
} from 'lucide-react';
import './PlatformView.css';
import { PlatformDiagram } from '@/architecture/PlatformDiagram';

// ===========================================================================
// Types
// ===========================================================================

interface Capability {
  slug: string;
  /** Outcome-first headline shown in the closed row (the value, not the product). */
  headline: string;
  /** Product name — shown small, after the headline. */
  name: string;
  icon: LucideIcon;
  pitch: string;
  bullets: string[];
  docUrl: string;
}

interface Layer {
  id: string;
  step: string;
  title: string;
  tagline: string;
  pitch: string;
  caps: Capability[];
  Scene: () => ReactElement;
}

// ===========================================================================
// Reusable: a "logo pill" that uses a Lucide icon for the brand
// ===========================================================================

function LogoPill({
  Icon,
  label,
  x,
  y,
  tint,
}: {
  Icon: LucideIcon;
  label: string;
  x: number;
  y: number;
  tint: string;
}) {
  // Pill auto-sizes around its label so longer text doesn't get cropped.
  // Width = icon column (32) + per-char text width estimate + right padding (12).
  const textWidth = label.length * 6.2;
  const pillWidth = Math.max(96, 32 + textWidth + 12);
  return (
    <g transform={`translate(${x} ${y - 16})`}>
      <rect
        width={pillWidth}
        height="32"
        rx="16"
        fill="var(--card)"
        stroke="var(--border)"
        strokeWidth="1"
      />
      {/* Icon container: a tinted rounded square so the brand glyph reads */}
      <rect x="5" y="5" width="22" height="22" rx="7" fill={tint} opacity="0.18" />
      <foreignObject x="5" y="5" width="22" height="22">
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: tint,
          }}
        >
          <Icon style={{ width: 14, height: 14 }} strokeWidth={2.25} />
        </div>
      </foreignObject>
      <text
        x="34"
        y="20"
        fontSize="10.5"
        fontWeight="600"
        fill="var(--foreground)"
      >
        {label}
      </text>
    </g>
  );
}

// ===========================================================================
// Scene 1 — Ingest + Transform
// Sources (with Lucide icons) flow into a Spark Declarative Pipeline hub.
// ===========================================================================

function IngestTransformScene() {
  // Sources, each with a Lucide icon that *feels* right for the source type.
  // Tint colors stay subtle, theme-friendly. Pill widths grow to fit text.
  const sources = [
    { name: 'SaaS apps', icon: Cloud, x: 14, y: 38, tint: 'var(--platform-source-saas)' },
    { name: 'ERP / OLTP', icon: Server, x: 14, y: 90, tint: 'var(--platform-source-erp)' },
    { name: 'Streams', icon: Activity, x: 14, y: 142, tint: 'var(--platform-source-streams)' },
    { name: 'Object store', icon: Box, x: 14, y: 194, tint: 'var(--platform-source-object)' },
    { name: 'Databases', icon: HardDrive, x: 14, y: 246, tint: 'var(--platform-source-db)' },
  ];
  const hubX = 280;
  const hubY = 142;
  // pill width formula must mirror LogoPill
  const pillWidth = (label: string) =>
    Math.max(96, 32 + label.length * 6.2 + 12);

  return (
    <>
    {/* Mobile-only HTML rendering — SVG fixed coords don't reflow under ~360px */}
    <div className="dx-ingest-mobile" aria-hidden>
      <div className="dx-ingest-mobile-sources">
        {sources.map((s) => {
          const Icon = s.icon;
          return (
            <span key={`m-${s.name}`} className="dx-ingest-mobile-pill">
              <span
                className="dx-ingest-mobile-icon"
                style={{ color: s.tint }}
              >
                <Icon className="size-3.5" />
              </span>
              {s.name}
            </span>
          );
        })}
      </div>
      <div className="dx-ingest-mobile-arrow">↓</div>
      <div className="dx-ingest-mobile-hub">
        {[
          { label: 'Bronze', dot: 'var(--medal-bronze)' },
          { label: 'Silver', dot: 'var(--medal-silver)' },
          { label: 'Gold', dot: 'var(--medal-gold)' },
        ].map((tier) => (
          <span key={tier.label} className="dx-ingest-mobile-tier">
            <span
              className="dx-ingest-mobile-tier-dot"
              style={{ background: tier.dot }}
            />
            {tier.label}
          </span>
        ))}
        <span className="dx-ingest-mobile-hub-label">DECLARATIVE PIPELINE</span>
      </div>
    </div>
    <svg viewBox="0 0 380 296" className="dx-scene-svg dx-ingest-svg">
      {/* lines */}
      {sources.map((s) => (
        <line
          key={`l-${s.name}`}
          x1={s.x + pillWidth(s.name)}
          y1={s.y}
          x2={hubX - 8}
          y2={hubY}
          stroke="var(--border)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
      ))}
      {/* travelling dots */}
      {sources.map((s, i) => (
        <circle key={`d-${s.name}`} r="3.5" fill="var(--primary)">
          <animateMotion
            dur="2.6s"
            repeatCount="indefinite"
            begin={`${i * 0.4}s`}
            path={`M ${s.x + pillWidth(s.name)} ${s.y} L ${hubX - 8} ${hubY}`}
          />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.1;0.9;1"
            dur="2.6s"
            repeatCount="indefinite"
            begin={`${i * 0.4}s`}
          />
        </circle>
      ))}
      {/* source pills */}
      {sources.map((s) => (
        <LogoPill
          key={`p-${s.name}`}
          Icon={s.icon}
          label={s.name}
          x={s.x}
          y={s.y}
          tint={s.tint}
        />
      ))}
      {/* central hub: Declarative Pipeline */}
      <g transform={`translate(${hubX - 60} ${hubY - 56})`}>
        <rect
          width="120"
          height="112"
          rx="14"
          fill="var(--primary)"
          opacity="0.08"
        />
        <rect
          width="120"
          height="112"
          rx="14"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.5"
        />
        {/* tier rows */}
        {[
          { label: 'Bronze', dot: 'var(--medal-bronze)' },
          { label: 'Silver', dot: 'var(--medal-silver)' },
          { label: 'Gold', dot: 'var(--medal-gold)' },
        ].map((tier, i) => (
          <g key={tier.label} transform={`translate(12 ${20 + i * 24})`}>
            <rect
              width="96"
              height="18"
              rx="4"
              fill="var(--card)"
              stroke="var(--border)"
              strokeWidth="0.75"
            />
            <circle cx="10" cy="9" r="3.5" fill={tier.dot} />
            <text
              x="20"
              y="12.5"
              fontSize="9.5"
              fontWeight="600"
              fill="var(--foreground)"
            >
              {tier.label}
            </text>
          </g>
        ))}
      </g>
      <text
        x={hubX}
        y={hubY + 76}
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="700"
        fill="var(--primary)"
        letterSpacing="0.5"
      >
        DECLARATIVE PIPELINE
      </text>
    </svg>
    </>
  );
}

// ===========================================================================
// Scene 2 — Govern + Define
// Central catalog medallion (with shield) + lineage threads radiating to
// consumer chips.
// ===========================================================================

function GovernScene() {
  const consumers = [
    { x: 80, y: 50, label: 'Analyst', icon: MessagesSquare },
    { x: 320, y: 60, label: 'Dashboard', icon: BarChart3 },
    { x: 70, y: 220, label: 'Agent', icon: Sparkles },
    { x: 330, y: 210, label: 'App', icon: AppWindow },
    { x: 200, y: 30, label: 'Auditor', icon: ShieldCheck },
    { x: 200, y: 250, label: 'Pipeline', icon: Workflow },
  ];
  return (
    <svg viewBox="0 12 380 256" className="dx-scene-svg">
      {/* lineage lines */}
      {consumers.map((c, i) => (
        <line
          key={`gl-${i}`}
          x1="190"
          y1="140"
          x2={c.x}
          y2={c.y}
          stroke="var(--border)"
          strokeWidth="1.5"
          strokeDasharray="2 4"
        />
      ))}
      {/* travelling dots out toward consumers */}
      {consumers.slice(0, 4).map((c, i) => (
        <circle key={`gd-${i}`} r="3" fill="var(--primary)">
          <animateMotion
            dur="3s"
            repeatCount="indefinite"
            begin={`${i * 0.5}s`}
            path={`M 190 140 L ${c.x} ${c.y}`}
          />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.1;0.9;1"
            dur="3s"
            repeatCount="indefinite"
            begin={`${i * 0.5}s`}
          />
        </circle>
      ))}
      {/* consumer chips with Lucide icons */}
      {consumers.map((c) => (
        <g key={`gc-${c.label}`} transform={`translate(${c.x - 42} ${c.y - 13})`}>
          <rect
            width="84"
            height="26"
            rx="13"
            fill="var(--card)"
            stroke="var(--border)"
            strokeWidth="1"
          />
          <foreignObject x="6" y="5" width="16" height="16">
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
              }}
            >
              <c.icon style={{ width: 12, height: 12 }} strokeWidth={2.25} />
            </div>
          </foreignObject>
          <text
            x="28"
            y="17"
            fontSize="9.5"
            fontWeight="600"
            fill="var(--foreground)"
          >
            {c.label}
          </text>
        </g>
      ))}
      {/* catalog medallion + shield */}
      <g transform="translate(190 140)">
        <circle r="46" fill="var(--primary)" opacity="0.10" />
        <circle r="46" fill="none" stroke="var(--primary)" strokeWidth="1.5">
          <animate
            attributeName="r"
            values="46;52;46"
            dur="3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.7;0;0.7"
            dur="3s"
            repeatCount="indefinite"
          />
        </circle>
        <circle r="34" fill="var(--card)" stroke="var(--primary)" strokeWidth="1.5" />
        <foreignObject x="-14" y="-14" width="28" height="28">
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
            }}
          >
            <ShieldCheck style={{ width: 24, height: 24 }} strokeWidth={2.25} />
          </div>
        </foreignObject>
      </g>
      <text
        x="190"
        y="207"
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="700"
        fill="var(--primary)"
        letterSpacing="0.5"
      >
        UNITY CATALOG
      </text>
    </svg>
  );
}

// ===========================================================================
// Scene 3 — Speak to your data + Agent Bricks
// One scene, four outputs sharing the same governed-data plinth at the bottom:
//   • Dashboards  → BI for the eyes
//   • Genie       → natural language → SQL
//   • KA          → RAG over your docs
//   • MAS         → orchestrates all three
// Agent Bricks add value: bring your data, ground every answer, route across tools.
// ===========================================================================

function SpeakToDataScene() {
  // 3 capability chips in a centered row, all fed by a single governed-data
  // plinth below. Each chip is just an icon + label + a one-line value prop.
  // Knowledge Assistant + Multi-Agent Supervisor are merged into a single
  // "Agent Bricks" chip to keep the diagram simple.

  // 3 chips at width 112 + 14 gap, centered in the 380 viewBox.
  const chipW = 112;
  const chipH = 96;
  const chips = [
    {
      label: 'AI/BI Dashboard',
      sub: 'See the numbers',
      icon: BarChart3,
      x: 8,
      y: 60,
    },
    {
      label: 'Genie',
      sub: 'Ask in natural language',
      icon: Sparkles,
      x: 134,
      y: 60,
    },
    {
      label: 'Agent Bricks',
      sub: 'Agents on your data',
      icon: Network,
      x: 260,
      y: 60,
    },
  ];

  return (
    <svg viewBox="0 0 380 290" className="dx-scene-svg">
      {/* Shared governed-data plinth at the bottom */}
      <g>
        <rect
          x="20"
          y="232"
          width="340"
          height="44"
          rx="11"
          fill="var(--primary)"
          opacity="0.10"
        />
        <rect
          x="20"
          y="232"
          width="340"
          height="44"
          rx="11"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        <text
          x="190"
          y="252"
          textAnchor="middle"
          fontSize="10"
          fontWeight="700"
          fill="var(--primary)"
          letterSpacing="0.6"
        >
          YOUR GOVERNED DATA + DOCS
        </text>
        <text
          x="190"
          y="267"
          textAnchor="middle"
          fontSize="8.5"
          fill="var(--muted-foreground)"
        >
          Delta · Metric Views · UC Volumes
        </text>
      </g>

      {/* Feed lines from plinth up into each chip's center */}
      {chips.map((c, i) => {
        const cx = c.x + chipW / 2;
        const cyBottom = c.y + chipH;
        return (
          <g key={`feed-${i}`}>
            <line
              x1={cx}
              y1="232"
              x2={cx}
              y2={cyBottom}
              stroke="var(--border)"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
            <circle r="2.5" fill="var(--primary)">
              <animateMotion
                dur="2.4s"
                repeatCount="indefinite"
                begin={`${i * 0.55}s`}
                path={`M ${cx} 232 L ${cx} ${cyBottom}`}
              />
              <animate
                attributeName="opacity"
                values="0;1;0"
                dur="2.4s"
                repeatCount="indefinite"
                begin={`${i * 0.55}s`}
              />
            </circle>
          </g>
        );
      })}

      {/* Capability chips — icon top, label below, value-prop below that */}
      {chips.map((c, i) => (
        <g
          key={`chip-${i}`}
          transform={`translate(${c.x} ${c.y})`}
          className={`dx-pulse-${(i % 4) + 1}`}
        >
          <rect
            width={chipW}
            height={chipH}
            rx="14"
            fill="var(--card)"
            stroke="var(--border)"
            strokeWidth="1.5"
          />
          {/* tinted icon square — centered on x */}
          <rect
            x={chipW / 2 - 18}
            y="14"
            width="36"
            height="36"
            rx="10"
            fill="var(--primary)"
            opacity="0.12"
          />
          <foreignObject x={chipW / 2 - 18} y="14" width="36" height="36">
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
              }}
            >
              <c.icon style={{ width: 18, height: 18 }} strokeWidth={2.25} />
            </div>
          </foreignObject>
          <text
            x={chipW / 2}
            y="66"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill="var(--foreground)"
          >
            {c.label}
          </text>
          <text
            x={chipW / 2}
            y="82"
            textAnchor="middle"
            fontSize="9"
            fill="var(--muted-foreground)"
          >
            {c.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ===========================================================================
// Scene 5 — Act
// Mock app window + live activity feed + operator avatar with pulse.
// ===========================================================================

function ActScene() {
  return (
    <svg viewBox="0 20 380 184" className="dx-scene-svg">
      <g transform="translate(80 32)">
        <rect
          width="220"
          height="160"
          rx="12"
          fill="var(--card)"
          stroke="var(--border)"
          strokeWidth="1.5"
        />
        <rect width="220" height="22" rx="12" fill="var(--primary)" opacity="0.10" />
        <circle cx="14" cy="11" r="3" fill="var(--trafficlight-red)" />
        <circle cx="26" cy="11" r="3" fill="var(--trafficlight-yellow)" />
        <circle cx="38" cy="11" r="3" fill="var(--trafficlight-green)" />
        <rect x="0" y="22" width="44" height="138" fill="var(--muted)" opacity="0.5" />
        <rect x="8" y="32" width="28" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.4" />
        <rect x="8" y="42" width="24" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.4" />
        <rect x="8" y="52" width="28" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.4" />
        {/* KPI cards */}
        <g transform="translate(56 34)">
          <rect width="48" height="32" rx="6" fill="var(--background)" stroke="var(--border)" />
          <rect x="6" y="8" width="20" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.5" />
          <text x="6" y="26" fontSize="11" fontWeight="700" fill="var(--foreground)">
            $180K
          </text>
        </g>
        <g transform="translate(110 34)">
          <rect width="48" height="32" rx="6" fill="var(--background)" stroke="var(--border)" />
          <rect x="6" y="8" width="20" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.5" />
          <text x="6" y="26" fontSize="11" fontWeight="700" fill="var(--primary)">
            24%
          </text>
        </g>
        <g transform="translate(164 34)">
          <rect width="48" height="32" rx="6" fill="var(--background)" stroke="var(--border)" />
          <rect x="6" y="8" width="20" height="4" rx="2" fill="var(--muted-foreground)" opacity="0.5" />
          <text x="6" y="26" fontSize="11" fontWeight="700" fill="var(--foreground)">
            5
          </text>
        </g>
        {/* live feed */}
        <g transform="translate(56 76)">
          <rect width="156" height="78" rx="6" fill="var(--background)" stroke="var(--border)" />
          <circle cx="10" cy="12" r="3.5" fill="var(--trafficlight-green)">
            <animate
              attributeName="opacity"
              values="1;0.3;1"
              dur="1.4s"
              repeatCount="indefinite"
            />
          </circle>
          <text x="20" y="15" fontSize="8" fontWeight="600" fill="var(--foreground)">
            Live
          </text>
          {[
            'Refund processed · $52',
            'Coupon sent · CUST-…',
            'Audit logged',
            'Refund processed · $68',
          ].map((t, i) => (
            <g key={i} transform={`translate(10 ${28 + i * 12})`}>
              <circle r="2" cx="2" cy="-2" fill="var(--primary)" opacity={1 - i * 0.2} />
              <text x="10" y="0" fontSize="7.5" fill="var(--muted-foreground)">
                {t}
              </text>
            </g>
          ))}
        </g>
      </g>
      {/* operator + label.
          On desktop the avatar sits bottom-left of the SVG and a label
          below reads "OPERATOR".
          On phone, the bottom-left position drifts relative to the
          shrinking mock-app frame and reads as "floating in space".
          CSS moves the avatar to the browser's top-right corner and
          hides the label so the meaning carries from position alone. */}
      <g className="dx-act-operator-avatar" transform="translate(40 170)">
        <circle r="20" fill="var(--primary)" opacity="0.10" />
        <circle r="20" fill="none" stroke="var(--primary)" strokeWidth="1.5">
          <animate attributeName="r" values="20;26;20" dur="2.2s" repeatCount="indefinite" />
          <animate
            attributeName="opacity"
            values="0.5;0;0.5"
            dur="2.2s"
            repeatCount="indefinite"
          />
        </circle>
        <circle r="14" fill="var(--card)" stroke="var(--primary)" strokeWidth="1.5" />
        <circle cx="0" cy="-3" r="4" fill="var(--primary)" />
        <path d="M -7 8 C -7 2 7 2 7 8" fill="var(--primary)" />
      </g>
      <text
        className="dx-act-operator-label"
        x="40"
        y="198"
        textAnchor="middle"
        fontSize="9"
        fontWeight="600"
        fill="var(--muted-foreground)"
        letterSpacing="0.5"
      >
        OPERATOR
      </text>
    </svg>
  );
}

// ===========================================================================
// Layers
// ===========================================================================

const LAYERS: Layer[] = [
  {
    id: 'ingest-transform',
    step: '',
    title: 'Bring all your data in',
    tagline: 'Every source. One place. Always fresh.',
    pitch:
      'Connect everything that runs your business and turn it into trusted, ready-to-use data — without an engineering team babysitting pipelines.',
    Scene: IngestTransformScene,
    caps: [
      {
        slug: 'lakeflow-connect',
        headline: 'Connect to anything, in clicks.',
        name: 'Lakeflow Connect',
        icon: Cable,
        pitch:
          'Salesforce, Workday, SAP, your databases — point and click, no connector to write or maintain.',
        bullets: [
          '200+ sources out of the box: SaaS, databases, files, streams.',
          'Always fresh — schema changes handled for you.',
          'Retire the home-grown ingestion stack and the team that babysits it.',
        ],
        docUrl: 'https://www.databricks.com/product/data-engineering/lakeflow-connect',
      },
      {
        slug: 'sdp',
        headline: 'ETL made simple for everyone.',
        name: 'Spark Declarative Pipelines',
        icon: Workflow,
        pitch:
          'Describe what you want; the platform builds, runs, and self-heals the pipeline.',
        bullets: [
          'Ship pipelines in days, not quarters — write the logic, skip the plumbing.',
          'Built-in data quality flags bad rows before reports go wrong.',
          'One framework for batch and streaming.',
        ],
        docUrl: 'https://www.databricks.com/product/data-engineering/spark-declarative-pipelines',
      },
    ],
  },
  {
    id: 'govern',
    step: '',
    title: 'Govern it once',
    tagline: 'One permission model. One definition. Trusted everywhere.',
    pitch:
      'Open your data to the business without losing sleep over compliance — every dataset, dashboard, and AI agent under one source of truth.',
    Scene: GovernScene,
    caps: [
      {
        slug: 'unity-catalog',
        headline: 'Govern once, trust everywhere.',
        name: 'Unity Catalog',
        icon: ShieldCheck,
        pitch:
          'Unified governance for every asset — tables, models, agents, files, dashboards — across clouds and teams.',
        bullets: [
          'Set a permission once; it applies to dashboards, Genie, agents, and tools alike.',
          'Pass your next audit in days, not months — every query and change logged automatically.',
          'Open the data to more people without opening the door to risk.',
        ],
        docUrl: 'https://www.databricks.com/product/unity-catalog',
      },
      {
        slug: 'metric-views',
        headline: 'A semantic layer for your business.',
        name: 'Metric Views',
        icon: Gauge,
        pitch:
          'Define every KPI once in a governed semantic layer — every dashboard, Genie answer, and agent agrees.',
        bullets: [
          'One definition of revenue, margin, churn — used consistently across BI, AI, and apps.',
          'Ratios, distinct counts, YoY — aggregate correctly however your team slices.',
          'Change a definition once; every report and AI assistant updates automatically.',
        ],
        docUrl: 'https://docs.databricks.com/aws/en/business-semantics/metric-views/',
      },
    ],
  },
  {
    id: 'speak-to-data',
    step: '',
    title: 'Put it to work for every team',
    tagline: 'See it. Ask it. Let agents act on it.',
    pitch:
      'Give every team the answers they need — dashboards, natural-language Q&A, or AI agents — all grounded in the same trusted data.',
    Scene: SpeakToDataScene,
    caps: [
      {
        slug: 'aibi-dashboards',
        headline: 'Scale BI to everyone — no extra cost.',
        name: 'AI/BI Dashboards',
        icon: BarChart3,
        pitch:
          'Agentic business intelligence: dashboards your team builds themselves, with Genie built in.',
        bullets: [
          'Turn a question into a published dashboard in minutes — no SQL, no BI specialist.',
          'Retire the legacy BI stack and its six-figure licenses.',
          'Same permissions as the underlying data — no parallel access setup.',
        ],
        docUrl: 'https://docs.databricks.com/aws/en/dashboards/',
      },
      {
        slug: 'genie',
        headline: 'AI that knows your business.',
        name: 'Genie',
        icon: Sparkles,
        pitch:
          'Talk to your data — explore any question, go beyond your dashboards.',
        bullets: [
          'Self-service for the 90% of questions that today queue up in your data team\'s inbox.',
          'Shows the SQL it ran and the chart it produced — never a black box.',
          'Trained on your tables and your vocabulary, not a generic model.',
        ],
        docUrl: 'https://docs.databricks.com/aws/en/genie/',
      },
    ],
  },
  {
    id: 'act',
    step: '',
    title: 'Turn it into action',
    tagline: 'Bring your apps to your data — not the other way around.',
    pitch:
      'Apps and agents in production, on the same platform as your data. No separate hosting, no separate identity, no separate compliance review.',
    Scene: ActScene,
    caps: [
      {
        slug: 'lakebase',
        headline: 'Transactional data, built for the agentic era.',
        name: 'Lakebase',
        icon: Database,
        pitch:
          'Serverless Postgres next to your data and AI — designed for apps and agents.',
        bullets: [
          'Launches in under a second; pay only for what you use.',
          'Retire the operational DB outside your data platform — no nightly exports, no two sources of truth.',
          'One identity, one bill, one governance model with the rest of your platform.',
        ],
        docUrl: 'https://docs.databricks.com/aws/en/lakebase/index.html',
      },
      {
        slug: 'databricks-apps',
        headline: 'Bring your apps to your data.',
        name: 'Databricks Apps',
        icon: AppWindow,
        pitch:
          'Secure, governed apps — built and deployed in the same place as your data and AI.',
        bullets: [
          'Idea to live app in days — investigation consoles, approval flows, copilots.',
          'No separate hosting, no separate sign-on, no separate audit trail.',
          'Production-grade by default: per-user access, full audit, managed credentials.',
        ],
        docUrl: 'https://www.databricks.com/product/databricks-apps',
      },
    ],
  },
];

// ===========================================================================
// Capability accordion (right-hand column)
// ===========================================================================

function CapabilityRow({ cap }: { cap: Capability }) {
  const [open, setOpen] = useState(false);
  const Icon = cap.icon;
  return (
    <div className={`dx-cap ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="dx-cap-row"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="dx-cap-icon">
          <Icon className="size-4" />
        </span>
        <span className="dx-cap-text">
          <span className="dx-cap-name">{cap.headline}</span>
          <span className="dx-cap-product">{cap.name}</span>
        </span>
        <ChevronDown
          className={`size-3.5 dx-cap-chev ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="dx-cap-details">
          <p className="dx-cap-pitch">{cap.pitch}</p>
          <ul>
            {cap.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          <a
            href={cap.docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="dx-cap-doc"
          >
            Learn more <ExternalLink className="size-3" />
          </a>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Layer band
// ===========================================================================

function LayerBand({ layer, index }: { layer: Layer; index: number }) {
  const Scene = layer.Scene;
  const hasStrip =
    layer.id === 'ingest-transform' || layer.id === 'speak-to-data';
  // Layers whose scene already draws its own frame (Act's mock browser)
  // or wastes whitespace inside the scene-card (Govern's chip ring) get
  // the bare-scene modifier: phone-only, drops the outer tinted chrome
  // and tightens vertical padding around the scene.
  const bareScene = layer.id === 'govern' || layer.id === 'act';
  return (
    <section
      className={[
        'dx-layer',
        hasStrip && 'has-genie-strip',
        bareScene && 'dx-layer--bare-scene',
      ]
        .filter(Boolean)
        .join(' ')}
      data-layer-id={layer.id}
      style={{ animationDelay: `${index * 140}ms` }}
    >
      <div className="dx-layer-scene">
        <Scene />
      </div>
      <div className="dx-layer-content">
        <h2 className="dx-layer-title">{layer.title}</h2>
        <div className="dx-layer-tagline">{layer.tagline}</div>
        <p className="dx-layer-pitch">{layer.pitch}</p>
        <div className="dx-layer-caps">
          {layer.caps.map((cap) => (
            <CapabilityRow key={cap.slug} cap={cap} />
          ))}
        </div>
      </div>
      {layer.id === 'ingest-transform' && <GenieCodeStrip />}
      {layer.id === 'speak-to-data' && <AgenticAppsStrip />}
    </section>
  );
}

// ===========================================================================
// Genie Code strip — compact, sits INSIDE the Ingest + Transform layer.
// Keeps the framing ("describe it, get assets") but at sidebar scale.
// ===========================================================================

function GenieCodeStrip() {
  return (
    <div className="dx-genie-strip">
      <div className="dx-genie-strip-head">
        <span className="dx-genie-strip-icon">
          <Code2 className="size-3.5" />
        </span>
        <span className="dx-genie-strip-label">
          <strong>Built with Genie Code</strong>
          <span className="dx-genie-strip-sub">
            Describe the pipeline — Genie Code writes the SQL, the DAG, the tests.
          </span>
        </span>
      </div>

      {/* "Type a brief → get a pipeline" demo (Bronze → Silver → Gold) */}
      <div className="dx-genie-stage" aria-hidden>
        {/* Left: prompt input that types itself */}
        <div className="dx-genie-prompt">
          <span className="dx-genie-prompt-chev">$</span>
          <span className="dx-genie-prompt-text">
            <span className="dx-genie-prompt-typed">
              ingest turbine telemetry into a daily pipeline
            </span>
            <span className="dx-genie-prompt-caret" />
          </span>
        </div>

        {/* Arrow connector: solid track + travelling dot, anchored on both sides */}
        <div className="dx-genie-arrow">
          <span className="dx-genie-arrow-track" />
          <span className="dx-genie-arrow-dot" />
          <span className="dx-genie-arrow-head">▶</span>
        </div>

        {/* Right: emitted artifact — a tiny pipeline DAG (Bronze → Silver → Gold) */}
        <div className="dx-genie-artifact">
          <div className="dx-genie-artifact-bar">
            <Workflow className="size-3" />
            <span>pipeline.sql</span>
            <span className="dx-genie-artifact-status">ready</span>
          </div>
          <div className="dx-genie-artifact-body dx-pipeline-body">
            <div className="dx-pipeline-stage dx-pipeline-stage-bronze">
              <span className="dx-pipeline-dot" />
              <span className="dx-pipeline-label">Bronze</span>
            </div>
            <span className="dx-pipeline-arrow">→</span>
            <div className="dx-pipeline-stage dx-pipeline-stage-silver">
              <span className="dx-pipeline-dot" />
              <span className="dx-pipeline-label">Silver</span>
            </div>
            <span className="dx-pipeline-arrow">→</span>
            <div className="dx-pipeline-stage dx-pipeline-stage-gold">
              <span className="dx-pipeline-dot" />
              <span className="dx-pipeline-label">Gold</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Agentic Apps strip — sits inside the Speak-to-data layer.
// Same visual language as the Genie Code strip: head label + animated demo
// on the right. The demo here is a user question → specialist agents →
// grounded answer with sources, conveying KA + MAS in one beat.
// ===========================================================================

function AgenticAppsStrip() {
  return (
    <div className="dx-genie-strip">
      <div className="dx-genie-strip-head">
        <span className="dx-genie-strip-icon">
          <Sparkles className="size-3.5" />
        </span>
        <span className="dx-genie-strip-label">
          <strong>Enable agentic apps</strong>
          <span className="dx-genie-strip-sub">
            Turn your docs into experts. Route questions to the right specialist agent.
          </span>
        </span>
      </div>

      {/* MAS routing flow:
          question → supervisor fans out to specialists (Genie, KA, custom tool)
          → answers stream back → grounded synthesis. */}
      <div className="dx-mas-stage" aria-hidden>
        {/* User question — types itself, then routing fires */}
        <div className="dx-mas-question">
          <span className="dx-mas-question-chev">?</span>
          <span className="dx-mas-question-text">
            <span className="dx-mas-question-typed">Why are refunds up?</span>
            <span className="dx-mas-question-caret" />
          </span>
        </div>

        {/* Supervisor router */}
        <div className="dx-mas-router">
          <span className="dx-mas-router-icon">
            <Network className="size-3.5" />
          </span>
          <span className="dx-mas-router-label">Supervisor</span>
        </div>

        {/* Three specialist agents, lit sequentially */}
        <div className="dx-mas-agents">
          <div className="dx-mas-agent dx-mas-agent-1">
            <span className="dx-mas-agent-icon">
              <BarChart3 className="size-3" />
            </span>
            <span className="dx-mas-agent-name">Genie</span>
            <span className="dx-mas-agent-task">querying sales data…</span>
          </div>
          <div className="dx-mas-agent dx-mas-agent-2">
            <span className="dx-mas-agent-icon">
              <BookOpen className="size-3" />
            </span>
            <span className="dx-mas-agent-name">Knowledge Assistant</span>
            <span className="dx-mas-agent-task">searching refund policy…</span>
          </div>
          <div className="dx-mas-agent dx-mas-agent-3">
            <span className="dx-mas-agent-icon">
              <Box className="size-3" />
            </span>
            <span className="dx-mas-agent-name">Entity extraction</span>
            <span className="dx-mas-agent-task">parsing customer claims…</span>
          </div>
        </div>

      </div>
    </div>
  );
}

// ===========================================================================
// Flow connector
// ===========================================================================

function FlowConnector() {
  return (
    <div className="dx-flow-connector" aria-hidden>
      <svg viewBox="0 0 24 64" preserveAspectRatio="none">
        <line
          x1="12"
          y1="0"
          x2="12"
          y2="64"
          stroke="var(--border)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        <circle r="3.5" fill="var(--primary)">
          <animateMotion dur="2.8s" repeatCount="indefinite" path="M 12 0 L 12 64" />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.1;0.9;1"
            dur="2.8s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    </div>
  );
}

// ===========================================================================
// Main
// ===========================================================================

export function PlatformView() {
  return (
    <div className="dx-platform">
      <div className="dx-platform-inner">
        <PlatformDiagram />

        <header className="dx-hero">
          <div className="dx-hero-eyebrow">Databricks Data + AI Platform</div>
          <h1 className="dx-hero-title">Democratize data and AI.</h1>
          <p className="dx-hero-sub">
            Data democratized through AI. AI democratized through your data.
            Bring every source in, govern it once, and put it to work — for every
            team, every use case.
          </p>
        </header>

        {LAYERS.map((layer, i) => (
          <div key={layer.id}>
            <LayerBand layer={layer} index={i} />
            {i < LAYERS.length - 1 && <FlowConnector />}
          </div>
        ))}

        <footer className="dx-closing">
          <div className="dx-closing-rule" aria-hidden />
          <p className="dx-closing-text">
            <strong>Data democratized through AI. AI democratized through your data.</strong>
            <br />
            One platform. One source of truth. Every team — and every use case —
            on the same governed data.
          </p>
        </footer>
      </div>

    </div>
  );
}
