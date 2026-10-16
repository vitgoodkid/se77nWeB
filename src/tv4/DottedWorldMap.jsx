// Pixel-dot world SVG map for tv4 (the "overworld").
// Renders:
//   - Pixel-dot continent silhouettes (deterministic, no GeoJSON), drawn as two
//     <path>s (coast + inland) so the whole landmass is just two DOM nodes
//   - Blinking gold pixel markers on world capitals
//   - Trip home-base markers as pixel flags, user pins as pixel map pins;
//     click → onPinSelect, right-click anywhere → onContextMenu (lat/lng + px)
//
// Coordinates use equirectangular projection: x = (lng+180)/360 * W,
// y = (90-lat)/180 * H. Adjust H scale (×0.95 + small offset) so the dotted
// landmasses fit nicely in the viewport.

import { useMemo, useRef, useState } from 'react';
import { PIN_FILL } from './kit.jsx';

const W = 1000;
const H = 540;

// Subset of world capitals — the most recognizable, kept short on purpose so the
// blink layer stays readable. Coords are rough.
const CAPITALS = [
  { id: 'tokyo',     name: 'Tokyo',       lat: 35.68, lng: 139.69 },
  { id: 'seoul',     name: 'Seoul',       lat: 37.57, lng: 126.98 },
  { id: 'beijing',   name: 'Beijing',     lat: 39.90, lng: 116.41 },
  { id: 'taipei',    name: 'Taipei',      lat: 25.04, lng: 121.56 },
  { id: 'bangkok',   name: 'Bangkok',     lat: 13.75, lng: 100.50 },
  { id: 'hanoi',     name: 'Hanoi',       lat: 21.03, lng: 105.85 },
  { id: 'singapore', name: 'Singapore',   lat: 1.35,  lng: 103.82 },
  { id: 'jakarta',   name: 'Jakarta',     lat: -6.20, lng: 106.85 },
  { id: 'manila',    name: 'Manila',      lat: 14.60, lng: 120.98 },
  { id: 'newdelhi',  name: 'New Delhi',   lat: 28.61, lng: 77.21 },
  { id: 'dubai',     name: 'Dubai',       lat: 25.20, lng: 55.27 },
  { id: 'istanbul',  name: 'Istanbul',    lat: 41.01, lng: 28.98 },
  { id: 'moscow',    name: 'Moscow',      lat: 55.75, lng: 37.62 },
  { id: 'london',    name: 'London',      lat: 51.51, lng: -0.13 },
  { id: 'paris',     name: 'Paris',       lat: 48.86, lng: 2.35 },
  { id: 'berlin',    name: 'Berlin',      lat: 52.52, lng: 13.40 },
  { id: 'rome',      name: 'Rome',        lat: 41.90, lng: 12.50 },
  { id: 'madrid',    name: 'Madrid',      lat: 40.42, lng: -3.70 },
  { id: 'cairo',     name: 'Cairo',       lat: 30.04, lng: 31.24 },
  { id: 'nairobi',   name: 'Nairobi',     lat: -1.29, lng: 36.82 },
  { id: 'lagos',     name: 'Lagos',       lat: 6.52,  lng: 3.38 },
  { id: 'capetown',  name: 'Cape Town',   lat: -33.92, lng: 18.42 },
  { id: 'newyork',   name: 'New York',    lat: 40.71, lng: -74.01 },
  { id: 'washington', name: 'Washington', lat: 38.91, lng: -77.04 },
  { id: 'la',        name: 'Los Angeles', lat: 34.05, lng: -118.24 },
  { id: 'mexico',    name: 'Mexico City', lat: 19.43, lng: -99.13 },
  { id: 'rio',       name: 'Rio',         lat: -22.91, lng: -43.17 },
  { id: 'buenos',    name: 'Buenos Aires', lat: -34.61, lng: -58.38 },
  { id: 'sydney',    name: 'Sydney',      lat: -33.87, lng: 151.21 },
  { id: 'auckland',  name: 'Auckland',    lat: -36.85, lng: 174.76 },
];

// Pixel map pin (5×7 grid): square head narrowing to a point at the bottom.
const PIN_PATH = 'M1 0h3v1h1v3H4v1H3v2H2V5H1V4H0V1h1z';
const PIN_SCALE = 2.6;
// Pixel flag (6×7 grid): pole + pennant.
const FLAG_PATH = 'M1 0h5v1H5v1h1v2H1z';
const FLAG_SCALE = 3;

function project(lat, lng) {
  const x = ((lng + 180) / 360) * W;
  const y = ((90 - lat) / 180) * H;
  return [x, y * 0.95 + H * 0.025];
}

export default function DottedWorldMap({
  pins, trips, activeTripId, onPinSelect, onContextMenu,
}) {
  const land = useMemo(() => makePixelLand(W, H), []);
  const svgRef = useRef(null);
  const [hoverCap, setHoverCap] = useState(null);
  const [hoverPin, setHoverPin] = useState(null);
  const [hoverTrip, setHoverTrip] = useState(null);

  // Convert client px → svg viewBox coordinates → lat/lng (for right-click menu).
  const clientToLatLng = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const xRatio = (clientX - r.left) / r.width;
    const yRatio = (clientY - r.top) / r.height;
    const x = xRatio * W;
    const y = yRatio * H;
    // Reverse the project()'s y squish: y_svg = (raw_y) * 0.95 + H*0.025
    const rawY = (y - H * 0.025) / 0.95;
    const lng = (x / W) * 360 - 180;
    const lat = 90 - (rawY / H) * 180;
    return { lat, lng, x: clientX - r.left, y: clientY - r.top };
  };

  const onSvgContextMenu = (e) => {
    e.preventDefault();
    const c = clientToLatLng(e.clientX, e.clientY);
    if (c) onContextMenu?.(c);
  };

  const validPins = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  // Trip home-base markers — show on map even before any pins are dropped, so a
  // newly created trip (which seeded its homeBase from the right-click coords)
  // appears immediately. Skips trips that already have a real pin nearby.
  const tripMarkers = (trips || [])
    .filter((t) => t?.homeBase && Number.isFinite(t.homeBase.lat) && Number.isFinite(t.homeBase.lng))
    .filter((t) => !validPins.some((p) => p.tripId === t._id));

  const hoverLabel = hoverCap || hoverPin || hoverTrip;
  const ink = { stroke: 'var(--ink)' };
  const keySelect = (fn) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        ref={svgRef}
        role="img"
        aria-label="Pixel world map with capitals, trip flags and pins. Right-click to add a pin, plan a trip or set home."
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onContextMenu={onSvgContextMenu}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
      >
        {/* Continent silhouettes — pixel dots */}
        <path d={land.coast} shapeRendering="crispEdges" style={{ fill: 'var(--tv-coast)' }} />
        <path d={land.inland} shapeRendering="crispEdges" style={{ fill: 'var(--tv-land)' }} />

        {/* Capitals — blinking gold pixels */}
        {CAPITALS.map((c, i) => {
          const [x, y] = project(c.lat, c.lng);
          const on = hoverCap?.id === c.id;
          const s = on ? 11 : 7;
          return (
            <g
              key={c.id}
              style={{ cursor: 'help' }}
              onMouseEnter={() => setHoverCap({ id: c.id, name: c.name, x, y })}
              onMouseLeave={() => setHoverCap(null)}
            >
              <rect x={x - 9} y={y - 9} width="18" height="18" fill="transparent" />
              <rect
                className={on ? undefined : 'tv-cap'}
                x={x - s / 2} y={y - s / 2} width={s} height={s}
                fill="#ffd25e" strokeWidth="1.8" shapeRendering="crispEdges"
                style={{ ...ink, animationDelay: `${((i * 7) % 18) / 10}s` }}
              />
            </g>
          );
        })}

        {/* Trip home-base markers — pixel flags until a real pin lands */}
        {tripMarkers.map((t) => {
          const [x, y] = project(t.homeBase.lat, t.homeBase.lng);
          const dim = activeTripId && t._id !== activeTripId;
          const select = () => onPinSelect?.({ _id: `__trip_${t._id}`, tripId: t._id, name: t.title, lat: t.homeBase.lat, lng: t.homeBase.lng, type: 'other' });
          return (
            <g
              key={`trip-${t._id}`}
              className="tv-pin"
              role="button"
              tabIndex={0}
              aria-label={`Select trip ${t.title}`}
              style={{ opacity: dim ? 0.35 : 1 }}
              transform={`translate(${(x - FLAG_SCALE / 2).toFixed(1)} ${(y - 7 * FLAG_SCALE).toFixed(1)})`}
              onClick={select}
              onKeyDown={keySelect(select)}
              onMouseEnter={() => setHoverTrip({ name: t.title + ' · home', x, y: y - 14 })}
              onMouseLeave={() => setHoverTrip(null)}
            >
              <g className="tv-lift">
                <g transform={`scale(${FLAG_SCALE})`} shapeRendering="crispEdges">
                  <rect x="0" y="0" width="1" height="7" style={{ fill: 'var(--tv-route)' }} />
                  <path d={FLAG_PATH} fill="#ffd25e" strokeWidth="0.3" style={{ stroke: '#1b1410' }} />
                </g>
              </g>
            </g>
          );
        })}

        {/* User trip pins on top */}
        {validPins.map((p) => {
          const [x, y] = project(p.lat, p.lng);
          const dim = activeTripId && p.tripId !== activeTripId;
          const col = PIN_FILL[p.type] || PIN_FILL.other;
          const wish = p.type === 'wishlist';
          const select = () => onPinSelect?.(p);
          return (
            <g
              key={p._id}
              className="tv-pin"
              role="button"
              tabIndex={0}
              aria-label={`Pin ${p.name || ''}`}
              style={{ opacity: dim ? 0.35 : 1 }}
              transform={`translate(${(x - 2.5 * PIN_SCALE).toFixed(1)} ${(y - 7 * PIN_SCALE).toFixed(1)})`}
              onClick={select}
              onKeyDown={keySelect(select)}
              onMouseEnter={() => setHoverPin({ name: p.name || '—', x, y: y - 12 })}
              onMouseLeave={() => setHoverPin(null)}
            >
              <g className={p.type === 'ongoing' ? 'bob' : undefined}>
                <g className="tv-lift">
                  <g transform={`scale(${PIN_SCALE})`} shapeRendering="crispEdges">
                    <path
                      d={PIN_PATH} fill={col} strokeWidth={wish ? 0.45 : 0.35}
                      strokeDasharray={wish ? '0.6 0.4' : undefined}
                      style={wish ? { stroke: '#c98a12' } : ink}
                    />
                    <rect x="2" y="2" width="1" height="1" style={{ fill: 'var(--ink)' }} />
                  </g>
                </g>
              </g>
            </g>
          );
        })}

        {/* Hover label — last layer so it draws over everything */}
        {hoverLabel && <HoverLabel x={hoverLabel.x} y={hoverLabel.y} text={hoverLabel.name} />}
      </svg>
    </div>
  );
}

function HoverLabel({ x, y, text }) {
  // SVG text width is hard to measure pre-render; estimate per Silkscreen char.
  const w = Math.max(40, text.length * 8.2 + 18);
  const pad = 10;
  // Flip to the left if too close to the right edge.
  const flip = x > W - w - pad;
  const lx = flip ? x - w - pad : x + pad;
  const ly = Math.max(2, y - 28);
  return (
    <g pointerEvents="none">
      <rect x={lx + 3} y={ly + 3} width={w} height={22} style={{ fill: 'var(--ink)', opacity: 0.35 }} />
      <rect x={lx} y={ly} width={w} height={22} style={{ fill: 'var(--strip)' }} />
      <text
        x={lx + w / 2} y={ly + 15}
        textAnchor="middle"
        fontFamily="Silkscreen, JetBrains Mono, monospace"
        fontSize="11"
        fontWeight="700"
        fill="#fffaf0"
      >{text.toUpperCase()}</text>
    </g>
  );
}

// Deterministic pixel-landmass painter. No GeoJSON dep — uses a handful of
// elliptical "regions" + holes to carve continents out of a uniform pixel grid.
// Returns two path strings: coast (outer rim) and inland cells.
function makePixelLand(W, H) {
  const step = 12;
  const size = 9;
  // Each tuple: [cx, cy, rx, ry, density 0..1]
  // Loosely traced from a Mercator world map at our viewBox size.
  const regions = [
    // North America
    [200, 175, 110, 90, 0.95], [210, 220, 80, 60, 0.85], [160, 280, 50, 40, 0.6],
    [280, 350, 50, 80, 0.92], [270, 410, 35, 50, 0.88],
    // South America
    [310, 380, 45, 65, 0.92], [330, 440, 25, 40, 0.85],
    // Europe
    [495, 165, 60, 50, 0.92],
    // Africa
    [510, 270, 70, 110, 0.95], [520, 350, 45, 50, 0.88],
    [555, 215, 35, 30, 0.85],
    // Asia (large block)
    [620, 145, 130, 50, 0.9], [720, 160, 100, 45, 0.85],
    [670, 245, 45, 50, 0.92],
    // SEA + India
    [750, 290, 50, 40, 0.92], [780, 320, 35, 30, 0.85],
    [760, 200, 70, 50, 0.9], [820, 215, 25, 25, 0.85],
    // Australia
    [830, 380, 75, 50, 0.92],
    // Indonesia
    [780, 340, 40, 18, 0.85],
    // Greenland
    [400, 90, 35, 35, 0.7],
    // UK
    [468, 155, 14, 18, 0.85],
  ];
  const holes = [[240, 240, 30, 25], [180, 195, 20, 25], [550, 230, 18, 12]];
  function inRegion(x, y) {
    let best = 0;
    for (const [cx, cy, rx, ry, d] of regions) {
      const v = ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry);
      if (v < 1) best = Math.max(best, d * (1 - v));
    }
    for (const [cx, cy, rx, ry] of holes) {
      const v = ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry);
      if (v < 1) best *= 0.1;
    }
    return best;
  }
  const coast = [];
  const inland = [];
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const d = inRegion(x, y);
      if (d > 0.05) {
        (d < 0.22 ? coast : inland).push(`M${x} ${y}h${size}v${size}h-${size}z`);
      }
    }
  }
  return { coast: coast.join(''), inland: inland.join('') };
}
