/**
 * "Where the affected customers live" — bubble map.
 *
 * Real world map (OSM/CARTO Positron raster tiles via react-leaflet) with
 * one CircleMarker per (city, country). Radius = sqrt-scaled customer
 * count. When the agent's bulk write fires `dataMutated`, every bucket
 * is refetched and the bubbles whose `total` changed get a brief stroke-
 * thickening "pulse" so the eye lands on what moved.
 *
 * Implementation notes (Leaflet has sharp edges):
 *   - radius is a top-level prop → react-leaflet calls setRadius() on diff.
 *   - pathOptions go through setStyle() — color, fillColor, weight all work.
 *   - className on pathOptions only applies at layer-create time (Leaflet's
 *     setStyle does NOT touch className), so we DON'T use CSS keyframes
 *     for the pulse — we vary `weight` (stroke width) for 1s instead.
 *   - FitBounds only re-fits when the set of (city,country) KEYS changes,
 *     not on count-only updates — otherwise the map wobbles every refetch.
 *   - Leaflet CSS is imported in client/src/index.css (not here) so tile
 *     sizing is correct on first paint, including HMR.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe2, RefreshCw } from 'lucide-react';
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import { fetchCityBreakdown } from '@/lib/returns';
import { dataMutated } from '@/lib/events';
import type { CityBucket, ReturnStatus } from '@/shared/types';

type Props = {
  status: ReturnStatus | 'all';
  lot: string;
};

const PRIMARY = '#1e2659'; // matches --primary; SVG fill won't take var(...)
const RADIUS_MIN = 5;
const RADIUS_MAX = 32;
const RADIUS_SCALE = 2.6;
const PULSE_MS = 1100;
const PULSE_WEIGHT = 4;
const REST_WEIGHT = 1.5;

function radiusFor(count: number): number {
  return Math.max(
    RADIUS_MIN,
    Math.min(RADIUS_MAX, Math.sqrt(Math.max(1, count)) * RADIUS_SCALE),
  );
}

// Re-fit only when the SET of city keys changes (lot changed, region
// filter narrowed, etc). Count-only changes (the agent flipping rows)
// must NOT pan the map.
function FitBoundsOnSetChange({ cities }: { cities: CityBucket[] }) {
  const map = useMap();
  const lastKey = useRef<string>('');

  useEffect(() => {
    if (cities.length === 0) return;
    const key = cities
      .map((c) => `${c.country}:${c.city}`)
      .sort()
      .join('|');
    if (key === lastKey.current) return;
    lastKey.current = key;

    const lats = cities.map((c) => c.lat);
    const lngs = cities.map((c) => c.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    if (Math.abs(maxLat - minLat) < 0.5 && Math.abs(maxLng - minLng) < 0.5) {
      map.setView([cities[0].lat, cities[0].lng], 6, { animate: true });
      return;
    }
    map.fitBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { padding: [40, 40], animate: true },
    );
  }, [cities, map]);
  return null;
}

export function CityMap({ status, lot }: Props) {
  const [cities, setCities] = useState<CityBucket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function reload() {
      fetchCityBreakdown({
        status: status === 'all' ? undefined : status,
        lot: lot || undefined,
      })
        .then((data) => {
          if (cancelled) return;
          setCities(data);
          setError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setError((e as Error).message);
        });
    }
    reload();
    const unsub = dataMutated.subscribe(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [status, lot]);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Couldn't load the map: {error}
      </div>
    );
  }

  if (cities === null) {
    return (
      <div className="rounded-xl border border-border bg-card h-[280px] sm:h-[340px] flex items-center justify-center text-sm text-muted-foreground gap-2">
        <RefreshCw className="size-3.5 animate-spin" />
        Loading map…
      </div>
    );
  }

  const totalCustomers = cities.reduce((a, c) => a + c.total, 0);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Globe2 className="size-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold truncate">
            Affected customers by city
          </h3>
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {cities.length} {cities.length === 1 ? 'city' : 'cities'} ·{' '}
          {totalCustomers}
        </div>
      </div>
      <div className="h-[280px] sm:h-[340px] relative">
        {cities.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No affected customers in the current scope.
          </div>
        ) : (
          <MapContainer
            center={[30, 10]}
            zoom={2}
            minZoom={2}
            scrollWheelZoom={false}
            worldCopyJump
            className="h-full w-full"
            style={{ background: 'var(--muted)' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              subdomains={['a', 'b', 'c', 'd']}
              maxZoom={19}
            />
            <FitBoundsOnSetChange cities={cities} />
            {cities.map((c) => (
              <CityBubble key={`${c.country}:${c.city}`} city={c} />
            ))}
          </MapContainer>
        )}
      </div>
    </div>
  );
}

function CityBubble({ city }: { city: CityBucket }) {
  // Track whether `city.total` changed between renders to decide if we
  // should pulse. Plain ref + state (no shared hook — see file header).
  const prevTotal = useRef<number | null>(null);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (prevTotal.current === null) {
      prevTotal.current = city.total;
      return;
    }
    if (prevTotal.current === city.total) return;
    prevTotal.current = city.total;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), PULSE_MS);
    return () => clearTimeout(t);
  }, [city.total]);

  // pathOptions identity must change for react-leaflet to call setStyle().
  // useMemo on (pulsing) — fresh object only when pulse state flips.
  const pathOptions = useMemo(
    () => ({
      color: PRIMARY,
      fillColor: PRIMARY,
      fillOpacity: pulsing ? 0.75 : 0.55,
      weight: pulsing ? PULSE_WEIGHT : REST_WEIGHT,
    }),
    [pulsing],
  );

  const premiumPct =
    city.total > 0 ? Math.round((city.premium / city.total) * 100) : 0;

  return (
    <CircleMarker
      center={[city.lat, city.lng]}
      radius={radiusFor(city.total)}
      pathOptions={pathOptions}
    >
      <Tooltip direction="top" offset={[0, -4]} opacity={1}>
        <div className="text-xs">
          <div className="font-semibold">
            {city.city}
            <span className="text-muted-foreground"> · {city.country}</span>
          </div>
          <div>{city.total} affected customers</div>
          <div>{premiumPct}% premium</div>
          <div>
            $
            {city.refund_usd.toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}{' '}
            refund
          </div>
        </div>
      </Tooltip>
    </CircleMarker>
  );
}
