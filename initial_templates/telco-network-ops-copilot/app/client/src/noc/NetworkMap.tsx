/**
 * The wall map: every cell site in the network, drawn at its real coordinates on
 * OpenStreetMap (keyless tiles, inverted into the NOC palette via CSS in index.css).
 * Healthy sites are faint specks; sites with alarms grow with their alarm count and
 * turn amber (degraded) or red (down), so the storm reads as a cluster before a word is read.
 */
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { MapSite } from '@/noc/api';

const COL = { up: '#3E5566', degraded: '#FFB020', down: '#FF4D5E' };

// Down sites scale with their alarm count but stay small enough that a 64-site storm reads as a cluster, not a blob.
function radiusFor(s: MapSite) {
  if (s.is_down) return Math.min(6.5, 2.8 + Math.sqrt(Math.max(1, s.active_alarms)) * 0.45);
  if (s.active_alarms > 0) return 3 + Math.min(2, s.active_alarms * 0.4);
  return 2.2;
}

/** Keep the map sized to its panel (the wall reflows on resize). */
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export function NetworkMap({ sites, stormRouter, onPick }: { sites: MapSite[]; stormRouter: string | null; onPick?: (s: MapSite) => void }) {
  const valid = useMemo(() => sites.filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)), [sites]);
  // Draw healthy sites first so the affected ones sit on top.
  const ordered = useMemo(() => [...valid].sort((a, b) => Number(a.is_down) - Number(b.is_down) || a.active_alarms - b.active_alarms), [valid]);
  const bounds = useMemo<[[number, number], [number, number]] | null>(() => {
    if (!valid.length) return null;
    const lats = valid.map((s) => s.latitude), lons = valid.map((s) => s.longitude);
    return [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]];
  }, [valid]);
  const downCount = valid.filter((s) => s.is_down).length;
  const degraded = valid.filter((s) => !s.is_down && s.active_alarms > 0).length;

  if (!bounds) return <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">Loading network…</div>;

  return (
    <div className="noc-map relative h-full w-full">
      <MapContainer bounds={bounds} boundsOptions={{ padding: [24, 24] }} scrollWheelZoom={false} className="h-full w-full" attributionControl>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <InvalidateOnResize />
        {ordered.map((s) => {
          const state = s.is_down ? 'down' : s.active_alarms > 0 ? 'degraded' : 'up';
          const onStorm = stormRouter != null && s.agg_router_id === stormRouter;
          return (
            <CircleMarker
              key={s.site_id}
              center={[s.latitude, s.longitude]}
              radius={radiusFor(s)}
              pathOptions={{ color: COL[state], fillColor: COL[state], fillOpacity: state === 'up' ? 0.55 : 0.85, weight: onStorm && state !== 'up' ? 1.5 : 0.5 }}
              eventHandlers={onPick ? { click: () => onPick(s) } : undefined}
            >
              <Tooltip direction="top" offset={[0, -6]} className="noc-tip">
                <div className="font-mono text-[11px] leading-snug">
                  <div className="font-semibold">{s.site_id} · {s.city ?? s.market ?? ''}</div>
                  <div>{s.site_name}</div>
                  <div>{s.is_down ? 'DOWN' : s.active_alarms > 0 ? 'degraded' : 'in service'} · {s.active_alarms} alarms · {s.subscribers_served.toLocaleString('en-US')} subs</div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-3 left-3 z-[400] rounded-md border border-[var(--border)] bg-[rgb(6_11_16/0.85)] px-3 py-2 font-mono text-[11px] text-[var(--muted-foreground)] backdrop-blur">
        <div className="mb-1 uppercase tracking-[0.14em]">Front Range · {valid.length} sites</div>
        <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#FF4D5E]" />down <b className="text-[var(--foreground)]">{downCount}</b></div>
        <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#FFB020]" />degraded <b className="text-[var(--foreground)]">{degraded}</b></div>
        <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#3E5566]" />in service</div>
      </div>
    </div>
  );
}
