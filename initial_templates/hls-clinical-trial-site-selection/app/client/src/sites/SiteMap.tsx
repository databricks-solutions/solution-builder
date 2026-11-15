/**
 * Site feasibility map — every investigator site in the CASCADE-CKD network on an OSM basemap.
 * Marker size = expected enrollment (model-predicted rate for candidates, observed rate for
 * active sites); marker colour = status. Shared by the home page and the site network page.
 */
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import { n0, pct, type SiteRow } from '@/trials/api';

export const SITE_COLORS = {
  active: '#4F46E5',
  zero: '#E11D48',
  rescue: '#D97706',
  candidate: '#94A3B8',
  activated: '#059669',
  closure: '#7C3AED',
} as const;

export function siteColor(s: SiteRow): string {
  if (s.opsStatus === 'activation_requested') return SITE_COLORS.activated;
  if (s.opsStatus === 'closure_review') return SITE_COLORS.closure;
  if (s.cascadeStatus === 'candidate') return s.metrics.rescue_eligible ? SITE_COLORS.rescue : SITE_COLORS.candidate;
  if (s.metrics.is_zero_enroller) return SITE_COLORS.zero;
  return SITE_COLORS.active;
}

/** Radius from the number that matters for the site: predicted rate (candidates) or observed rate (active). */
function siteRadius(s: SiteRow): number {
  const bump = s.opsStatus !== 'none' ? 1 : 0;
  if (s.cascadeStatus === 'candidate') return 4 + bump + Math.min(10, (s.metrics.predicted_rate_amended ?? 0) * 22);
  return 4 + bump + Math.min(8, (s.metrics.randomized_per_month ?? 0) * 2.5);
}

function FitToSites({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  // Refit only when the set of sites changes size (not on every refetch), so a live update never pans the map.
  const fitKey = points.length;
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(points, { padding: [24, 24] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit on count change only, by design
  }, [map, fitKey]);
  return null;
}

function ResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export function SiteMap({ sites, height = 420, onSelect }: { sites: SiteRow[]; height?: number; onSelect?: (siteId: string) => void }) {
  // Candidates first so active / action markers paint on top of them.
  const ordered = useMemo(() => {
    const rank = (s: SiteRow) => (s.opsStatus !== 'none' ? 2 : s.cascadeStatus === 'candidate' ? 0 : 1);
    return sites
      .filter((s) => s.latitude != null && s.longitude != null && Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
      .sort((a, b) => rank(a) - rank(b));
  }, [sites]);
  const points = useMemo(() => ordered.map((s) => [s.latitude!, s.longitude!] as [number, number]), [ordered]);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]" style={{ height }}>
      <MapContainer center={[39, -97]} zoom={4} scrollWheelZoom className="size-full">
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <FitToSites points={points} />
        <ResizeWatcher />
        {ordered.map((s) => {
          const m = s.metrics;
          return (
            <CircleMarker
              key={s.siteId}
              center={[s.latitude!, s.longitude!]}
              radius={siteRadius(s)}
              pathOptions={{ color: 'white', weight: 1.5, fillColor: siteColor(s), fillOpacity: 0.9 }}
              eventHandlers={onSelect ? { click: () => onSelect(s.siteId) } : undefined}
            >
              <Popup>
                <div className="min-w-[200px] text-xs text-[#111827]">
                  <div className="font-semibold">{s.siteName}</div>
                  <div className="text-[#5B6478]">{s.city}, {s.state} · {s.irbType} IRB</div>
                  {s.cascadeStatus === 'candidate' ? (
                    <div className="mt-1.5">
                      Rescue candidate · predicted <b>{m.predicted_rate_amended?.toFixed(2) ?? '—'}</b>/mo with amendment · {n0(m.eligible_amended_e4)} eligible
                    </div>
                  ) : (
                    <div className="mt-1.5">
                      <b>{n0(m.randomized)}</b> randomized · {m.randomized_per_month ?? 0}/mo · screen-fail {m.screen_fail_rate != null ? pct(m.screen_fail_rate) : '—'}
                      {m.competing_trial ? <div className="text-[#9F1239]">Competing: {m.competing_trial}</div> : null}
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

const LEGEND: Array<{ key: keyof typeof SITE_COLORS; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'zero', label: 'Zero enrollers' },
  { key: 'rescue', label: 'Rescue candidate (eligible)' },
  { key: 'candidate', label: 'Other candidate' },
  { key: 'activated', label: 'Activation requested' },
  { key: 'closure', label: 'Closure review' },
];

export function SiteLegend({ counts }: { counts?: Partial<Record<keyof typeof SITE_COLORS, number>> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--muted-foreground)]">
      {LEGEND.map((l) => (
        <span key={l.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full ring-2 ring-white" style={{ background: SITE_COLORS[l.key] }} />
          {l.label}
          {counts?.[l.key] != null && <span className="tabular-nums text-[var(--foreground)]">{counts[l.key]}</span>}
        </span>
      ))}
    </div>
  );
}
