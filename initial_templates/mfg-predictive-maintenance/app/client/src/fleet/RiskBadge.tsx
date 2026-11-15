import { TIER_STYLE, type RiskTier } from '@/lib/pdm';

export function RiskBadge({ tier, score }: { tier: RiskTier; score?: number }) {
  const s = TIER_STYLE[tier] ?? TIER_STYLE.Healthy;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {tier}
      {score !== undefined && <span className="font-mono">{score}</span>}
    </span>
  );
}
