/**
 * Static IATA → airport lookup for the route map. Keyed by the same IATA codes the flights API
 * returns (origin / destination), so markers and lines have stable keys. Coordinates are the
 * published airport reference points (decimal degrees). Add a code here when a new destination
 * appears in the data; an unknown code is simply not drawn on the map.
 */
export type Airport = { iata: string; city: string; lat: number; lon: number };

const ROWS: Array<[string, string, number, number]> = [
  ['ORD', "Chicago O'Hare", 41.9786, -87.9048],
  ['ATL', 'Atlanta', 33.6407, -84.4277],
  ['AUS', 'Austin', 30.1945, -97.6699],
  ['BNA', 'Nashville', 36.1245, -86.6782],
  ['BOS', 'Boston', 42.3656, -71.0096],
  ['CLE', 'Cleveland', 41.4117, -81.8498],
  ['DCA', 'Washington National', 38.8521, -77.0377],
  ['DEN', 'Denver', 39.8561, -104.6737],
  ['DFW', 'Dallas/Fort Worth', 32.8998, -97.0403],
  ['DTW', 'Detroit', 42.2162, -83.3554],
  ['FLL', 'Fort Lauderdale', 26.0726, -80.1527],
  ['FRA', 'Frankfurt', 50.0379, 8.5622],
  ['IAH', 'Houston', 29.9902, -95.3368],
  ['LAS', 'Las Vegas', 36.084, -115.1537],
  ['LAX', 'Los Angeles', 33.9416, -118.4085],
  ['LGA', 'New York LaGuardia', 40.7769, -73.874],
  ['LHR', 'London Heathrow', 51.47, -0.4543],
  ['MCI', 'Kansas City', 39.2976, -94.7139],
  ['MCO', 'Orlando', 28.4312, -81.3081],
  ['MIA', 'Miami', 25.7959, -80.287],
  ['MSP', 'Minneapolis', 44.8848, -93.2223],
  ['MSY', 'New Orleans', 29.9934, -90.258],
  ['PDX', 'Portland', 45.5898, -122.5951],
  ['PHX', 'Phoenix', 33.4342, -112.0116],
  ['PIT', 'Pittsburgh', 40.4915, -80.2329],
  ['RDU', 'Raleigh-Durham', 35.8776, -78.7875],
  ['SAN', 'San Diego', 32.7338, -117.1933],
  ['SEA', 'Seattle', 47.4502, -122.3088],
  ['SFO', 'San Francisco', 37.6213, -122.379],
  ['SLC', 'Salt Lake City', 40.7899, -111.9791],
  ['STL', 'St. Louis', 38.7487, -90.37],
  ['TPA', 'Tampa', 27.9755, -82.5332],
];

export const AIRPORTS: Record<string, Airport> = Object.fromEntries(
  ROWS.map(([iata, city, lat, lon]) => [iata, { iata, city, lat, lon }]),
);

export const airport = (iata: string | null | undefined) => (iata ? AIRPORTS[iata] ?? null : null);
