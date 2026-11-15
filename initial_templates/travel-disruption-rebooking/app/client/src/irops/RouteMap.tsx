/**
 * Route map — the hub (ORD) and every airport the cancelled flights were bound for. The view fits the
 * continental US (where ~all of the network is); long-haul stops (LHR, FRA …) are off that view, so they
 * are listed in a small inset instead of crushing the domestic network. Markers are keyed by IATA code
 * (stable across refetches) and sized by passengers. Colour follows the rebooking state: cancelled is
 * red-orange, awaiting/plan-ready is yellow, rebooked is green; routes are amber dashed while cancelled.
 * Real OpenStreetMap raster tiles (keyless), shown on a dark basemap via `.irops-map` in index.css.
 */
import { useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import { airport, type Airport } from '@/lib/airports';
import type { FlightRow } from './api';

const HUB = airport('ORD')!;

type Stop = Airport & { flights: FlightRow[]; pax: number; allCommitted: boolean; anyUnplanned: boolean };

/** Continental-US box: the view we fit to. Anything outside is long-haul and goes to the inset. */
const inContinentalUS = (a: Pick<Airport, 'lat' | 'lon'>) => a.lat > 20 && a.lat < 50 && a.lon > -130 && a.lon < -60;

const statusColor = (s: Stop) => (s.allCommitted ? 'var(--brand-2)' : s.anyUnplanned ? 'var(--brand-5)' : 'var(--brand-4)');

export function RouteMap({ rows, onOpen }: { rows: FlightRow[]; onOpen: (id: string) => void }) {
  const { domestic, longHaul } = useMemo(() => {
    const by = new Map<string, Stop>();
    for (const r of rows) {
      const a = airport(r.destination);
      if (!a) continue;
      const s = by.get(a.iata) ?? { ...a, flights: [], pax: 0, allCommitted: true, anyUnplanned: false };
      s.flights.push(r);
      s.pax += r.pax;
      s.allCommitted = s.allCommitted && r.status === 'committed';
      s.anyUnplanned = s.anyUnplanned || r.status === 'unplanned';
      by.set(a.iata, s);
    }
    const all = [...by.values()].sort((x, y) => y.pax - x.pax);
    return { domestic: all.filter(inContinentalUS), longHaul: all.filter((s) => !inContinentalUS(s)) };
  }, [rows]);

  // Bounds are fixed once the flights are known, so the map opens on its final view and tiles are
  // requested once (no refit while loading, which would abort in-flight tile requests).
  const points: Array<[number, number]> = [[HUB.lat, HUB.lon], ...domestic.map((s): [number, number] => [s.lat, s.lon])];
  const loaded = rows.length > 0;

  return (
    <section aria-label="Route map" className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-xl border border-[#2A2E36] bg-[#0A0B0D]">
      <div className="flex items-center justify-between gap-3 border-b border-[#2A2E36] bg-[#121419] px-4 py-2.5">
        <span className="font-mono text-[12px] font-semibold uppercase tracking-wider text-[var(--brand-1)]">
          {domestic.length} US · {longHaul.length} intl
        </span>
        <span className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          <span className="flex items-center gap-1 whitespace-nowrap"><i className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[var(--brand-1)]" />cancelled</span>
          <span className="flex items-center gap-1 whitespace-nowrap"><i className="inline-block size-2 rounded-full bg-[var(--brand-4)]" />plan ready</span>
          <span className="flex items-center gap-1 whitespace-nowrap"><i className="inline-block size-2 rounded-full bg-[var(--brand-2)]" />rebooked</span>
        </span>
      </div>
      <div className="irops-map relative isolate min-h-0 flex-1">
        {!loaded ? (
          <div className="flex h-full items-center justify-center font-mono text-xs text-[var(--muted-foreground)]">LOADING NETWORK…</div>
        ) : (
          <MapContainer
            bounds={points}
            // paddingBottomRight keeps the network clear of the floating copilot button in the lower-right.
            boundsOptions={{ paddingTopLeft: [24, 24], paddingBottomRight: [24, 96] }}
            minZoom={2}
            scrollWheelZoom={false}
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              referrerPolicy="strict-origin-when-cross-origin"
              maxZoom={19}
            />
            {[...domestic, ...longHaul].map((s) => (
              <Polyline key={`route-${s.iata}`} positions={[[HUB.lat, HUB.lon], [s.lat, s.lon]]}
                pathOptions={{ color: s.allCommitted ? 'var(--brand-2)' : 'var(--brand-1)', weight: 1.5, opacity: 0.8, dashArray: s.allCommitted ? undefined : '5 5' }} />
            ))}
            <CircleMarker key="hub-ORD" center={[HUB.lat, HUB.lon]} radius={7}
              pathOptions={{ color: '#FFFFFF', weight: 2, fillColor: 'var(--brand-1)', fillOpacity: 1 }}>
              <Tooltip permanent direction="right" offset={[9, 0]} opacity={1} className="irops-hub-label">
                <span className="font-mono text-[11px] font-bold">ORD HUB</span>
              </Tooltip>
            </CircleMarker>
            {domestic.map((s) => (
              <CircleMarker key={`stop-${s.iata}`} center={[s.lat, s.lon]} radius={Math.min(9, Math.max(4, 2 + Math.sqrt(s.pax) / 3))}
                pathOptions={{ color: '#0A0B0D', weight: 1, fillColor: statusColor(s), fillOpacity: 0.95 }}
                eventHandlers={{ click: () => onOpen(s.flights[0].id) }}>
                <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                  <span className="font-mono text-xs"><b>{s.iata}</b> {s.city} · {s.flights.length} {s.flights.length === 1 ? 'flight' : 'flights'} · {s.pax} pax</span>
                </Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        )}
        {longHaul.length > 0 && (
          <div className="pointer-events-auto absolute left-3 top-[88px] z-[500] max-w-[60%] rounded-md border border-[#2A2E36] bg-[#0A0B0D]/90 px-3 py-2 font-mono text-[11px] text-[var(--brand-ink)]">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Long-haul · off this view</div>
            {longHaul.map((s) => (
              <button key={`lh-${s.iata}`} onClick={() => onOpen(s.flights[0].id)} className="flex w-full items-center gap-2 py-0.5 text-left hover:text-[var(--brand-1)]">
                <span className="inline-block size-2 rounded-full" style={{ background: statusColor(s) }} />
                <b>{s.iata}</b><span>{s.city}</span><span className="text-[var(--muted-foreground)]">{s.flights.length} · {s.pax} pax →</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
