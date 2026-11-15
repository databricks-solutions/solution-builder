/**
 * County map — one circle per county office, coloured by median days to a SNAP
 * determination (the federal clock is 30). Circle area = open caseload.
 *
 * The county names are fictional, so the coordinates are an illustrative static
 * lookup of each county's office city (placed in one region so the OpenStreetMap
 * tiles read as a state). Keyless OSM tiles only.
 */
import { useEffect } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';

export type CountyScore = {
  county: string;
  region_type: string;
  median_days: number;
  snap_on_time_pct: number;
  open_cases: number;
  overdue_cases: number;
  open_per_worker: number;
};

/** County → office city coordinates (static; illustrative for the fictional counties). */
const COUNTY_OFFICE: Record<string, { city: string; lat: number; lon: number }> = {
  Harbor: { city: 'Port Harbor', lat: 41.52, lon: -81.69 },
  Capitol: { city: 'Westbrook City', lat: 39.96, lon: -82.99 },
  Lakeview: { city: 'Lakeview', lat: 40.9, lon: -81.2 },
  'Maple Grove': { city: 'Maple Grove', lat: 40.3, lon: -83.5 },
  Riverbend: { city: 'Riverbend', lat: 39.5, lon: -84.2 },
  'Cedar Falls': { city: 'Cedar Falls', lat: 42.4, lon: -83.1 },
  Tamarack: { city: 'Tamarack', lat: 41.1, lon: -84.6 },
  'Pine Ridge': { city: 'Pine Ridge', lat: 39.2, lon: -82.4 },
};

const OK = '#2E8540';
const WARN = '#FFBE2E';
const LATE = '#B50909';

/** Median days to determination, against the 30-day federal standard. */
function daysColor(days: number): string {
  if (days > 30) return LATE;
  if (days > 20) return WARN;
  return OK;
}

/**
 * Re-measure the map once it has laid out (it mounts inside a grid cell), then
 * fit every county office into view. The padding keeps markers clear of the
 * legend (bottom-left) and of the floating chat button (bottom-right).
 */
function FitCounties({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    const remeasure = () => {
      map.invalidateSize();
      if (points.length > 0) {
        map.fitBounds(points, { paddingTopLeft: [28, 28], paddingBottomRight: [96, 84], maxZoom: 8, animate: false });
      }
    };
    const t = setTimeout(remeasure, 0);
    window.addEventListener('resize', remeasure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', remeasure);
    };
    // points are derived from `key`; re-fit only when the set of offices changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

export function CountyMap({ rows }: { rows: CountyScore[] }) {
  const placed = rows.filter((r) => COUNTY_OFFICE[r.county] && Number.isFinite(r.median_days));
  const points = placed.map((r): [number, number] => [COUNTY_OFFICE[r.county].lat, COUNTY_OFFICE[r.county].lon]);
  return (
    <div className="relative h-[440px] w-full overflow-hidden rounded border border-[#DFE1E2]">
      <MapContainer center={[40.4, -82.8]} zoom={6} minZoom={5} maxZoom={9} scrollWheelZoom={false} className="h-full w-full" style={{ background: '#F0F0F0' }}>
        {/* Keyless OpenStreetMap tiles. */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          referrerPolicy="strict-origin-when-cross-origin"
          maxZoom={19}
        />
        <FitCounties points={points} />
        {placed.map((r) => {
          const pos = COUNTY_OFFICE[r.county];
          const isTamarack = r.county === 'Tamarack';
          return (
            <CircleMarker
              key={r.county}
              center={[pos.lat, pos.lon]}
              radius={Math.max(9, Math.sqrt(r.open_cases) * 2.2)}
              pathOptions={{ color: isTamarack ? '#1B1B1B' : '#FFFFFF', weight: isTamarack ? 3 : 2, fillColor: daysColor(r.median_days), fillOpacity: 0.9 }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <div className="text-[12px] leading-snug">
                  <div className="font-semibold">{r.county} County</div>
                  <div>Median {r.median_days} days to determination</div>
                  <div>{r.snap_on_time_pct}% of SNAP on time · {r.open_cases} open</div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="absolute bottom-2 left-2 z-[400] rounded bg-white/95 px-2.5 py-1.5 text-[11px] text-[#1B1B1B] shadow-sm">
        <div className="mb-1 font-semibold">Median days to determination</div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ background: OK }} />≤ 20</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ background: WARN }} />21–30</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ background: LATE }} />over 30 (federal clock)</span>
        </div>
      </div>
    </div>
  );
}
