// Dotted-world SVG map — port of the old TravelArchive style for tv4.
// Renders:
//   - Dotted continent silhouettes (deterministic, no GeoJSON)
//   - Glow + pulse on world capital markers
//   - User trip pins on top, click → onPinSelect / onMapRightClick for context menu
//
// Coordinates use equirectangular projection: x = (lng+180)/360 * W,
// y = (90-lat)/180 * H. Adjust H scale (×0.95 + small offset) so the dotted
// landmasses fit nicely in the viewport.

import { useMemo, useRef } from 'react';
import { COLORS } from '../lib.jsx';

const W = 1000;
const H = 540;

// Subset of world capitals — the most recognizable, kept short on purpose so the
// pulse layer stays readable. Coords are rough.
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

const PIN_COLORS = {
  see:      COLORS.green,
  eat:      COLORS.gold,
  move:     COLORS.red,
  stay:     '#9bb4ff',
  other:    COLORS.muted,
  wishlist: 'rgba(212,168,88,0.35)',
  ongoing:  COLORS.gold,
};

function project(lat, lng) {
  const x = ((lng + 180) / 360) * W;
  const y = ((90 - lat) / 180) * H;
  return [x, y * 0.95 + H * 0.025];
}

export default function DottedWorldMap({
  pins, activeTripId, onPinSelect, onContextMenu, onActivePinChange,
}) {
  const dots = useMemo(() => makeDottedLandscape(W, H), []);
  const svgRef = useRef(null);

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

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <style>{`
        @keyframes tv4CapitalPulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50%      { opacity: 0.95; transform: scale(1.4); }
        }
      `}</style>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onContextMenu={onSvgContextMenu}
        style={{
          width: '100%', height: '100%', display: 'block',
          background: COLORS.bg,
          cursor: 'crosshair',
        }}
      >
        <defs>
          <pattern id="tv4-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
          </pattern>
          <radialGradient id="tv4-capital-glow">
            <stop offset="0%"  stopColor={COLORS.gold} stopOpacity="0.6" />
            <stop offset="60%" stopColor={COLORS.gold} stopOpacity="0.15" />
            <stop offset="100%" stopColor={COLORS.gold} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width={W} height={H} fill="url(#tv4-grid)" />

        {/* Continent silhouettes */}
        {dots.map((d, i) => (
          <circle key={i} cx={d[0]} cy={d[1]} r={d[2]} fill="rgba(245,237,224,0.16)" />
        ))}

        {/* Capitals — pulse glow + steady core */}
        {CAPITALS.map((c) => {
          const [x, y] = project(c.lat, c.lng);
          return (
            <g key={c.id}>
              <circle cx={x} cy={y} r="14" fill={`url(#tv4-capital-glow)`}
                style={{
                  transformOrigin: `${x}px ${y}px`,
                  animation: `tv4CapitalPulse 2.6s ease-in-out infinite`,
                  animationDelay: `${(c.lat + c.lng) % 2}s`,
                }}
              />
              <circle cx={x} cy={y} r="2.2" fill={COLORS.gold} opacity="0.85" />
            </g>
          );
        })}

        {/* User trip pins on top */}
        {validPins.map((p) => {
          const [x, y] = project(p.lat, p.lng);
          const dim = activeTripId && p.tripId !== activeTripId;
          const col = PIN_COLORS[p.type] || PIN_COLORS.other;
          return (
            <g
              key={p._id}
              style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
              onClick={() => onPinSelect?.(p)}
            >
              <circle cx={x} cy={y} r="11" fill={col} opacity="0.18" />
              <circle cx={x} cy={y} r="6"  fill={col} opacity="0.4" />
              <circle cx={x} cy={y} r="3"  fill={col}>
                {p.type === 'ongoing' && (
                  <animate attributeName="r" values="3;4.6;3" dur="1.6s" repeatCount="indefinite" />
                )}
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Deterministic dotted-landmass painter. No GeoJSON dep — uses a handful of
// elliptical "regions" + holes to carve continents out of a uniform dot grid.
function makeDottedLandscape(W, H) {
  const out = [];
  const step = 9;
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
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const d = inRegion(x, y);
      if (d > 0.05) {
        const jx = Math.sin(x * 0.31 + y * 0.17) * 2;
        const jy = Math.cos(x * 0.13 + y * 0.29) * 2;
        out.push([x + jx, y + jy, 1.1 + d * 0.6]);
      }
    }
  }
  return out;
}
