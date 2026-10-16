import {
  geoMercator,
  geoOrthographic,
  geoPath,
  geoGraticule10,
  geoDistance,
  geoCircle,
} from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import world from 'world-atlas/countries-50m.json';
import type { CardData } from '../../shared/reading';
const topology = world as unknown as Topology<{
  countries: GeometryCollection;
  land: GeometryCollection;
}>;
const land = feature(topology, topology.objects.land);
const borders = mesh(topology, topology.objects.countries, (a, b) => a !== b);
const grat = geoGraticule10();
export function Atlas({ card }: { card: CardData }) {
  const located = card.fact?.lat !== undefined && card.fact?.lon !== undefined;
  const lon = card.fact?.lon ?? 0,
    lat = card.fact?.lat ?? 0;
  const projection = geoMercator()
    .center([lon, lat])
    .scale(located ? 280 : 48)
    .translate([160, 94])
    .clipExtent([
      [0, 0],
      [320, 188],
    ]);
  const path = geoPath(projection),
    globe = geoPath(
      geoOrthographic().rotate([-lon, -lat]).scale(18).translate([294, 22]),
    );
  const point = projection([lon, lat])!;
  const a = projection.invert!([20, 166])!,
    b = projection.invert!([80, 166])!;
  const km = Math.max(
    1,
    Math.round((geoDistance(a, b) * 6371.0088) / 100) * 100,
  );
  const area = card.fact?.radiusKm;
  return (
    <figure
      className={`atlas ${located ? '' : 'unlocated'}`}
      aria-label="真实地理舆图"
    >
      <div className="plate">
        图 {card.plate}
        <span>Natural Earth · Wikidata</span>
      </div>
      <svg
        viewBox="0 0 320 188"
        role="img"
        aria-label={located ? `${card.name}位置与参照地` : '未能定位的世界图'}
      >
        <rect width="320" height="188" fill="var(--map-water)" />
        <path
          d={path(land) ?? ''}
          fill="var(--map-land)"
          stroke="var(--map-coast)"
          strokeWidth=".6"
        />
        <path
          d={path(borders) ?? ''}
          fill="none"
          stroke="var(--map-border)"
          strokeWidth=".5"
        />
        <path
          d={path(grat) ?? ''}
          fill="none"
          stroke="var(--map-grat)"
          strokeWidth=".5"
        />
        <rect
          x="1"
          y="1"
          width="318"
          height="186"
          fill="none"
          stroke="var(--map-border)"
        />
        {[40, 100, 160, 220, 280].map((x) => (
          <g key={x}>
            <path d={`M${x},1v4 M${x},187v-4`} stroke="var(--map-coast)" />
            <text x={x} y="13" textAnchor="middle" className="coord">
              {Math.round(projection.invert!([x, 90])![0])}°
            </text>
          </g>
        ))}
        {located && (
          <>
            {area && (
              <path
                d={
                  path(
                    geoCircle()
                      .center([lon, lat])
                      .radius(((area / 6371.0088) * 180) / Math.PI)(),
                  ) ?? ''
                }
                fill="var(--accent-tint)"
                opacity=".7"
                stroke="var(--accent)"
                strokeDasharray="3 3"
              />
            )}
            {card.references.map((ref) => {
              const p = projection([ref.lon, ref.lat])!;
              return (
                <g key={ref.name}>
                  <path
                    d={`M${point[0]},${point[1]}L${p[0]},${p[1]}`}
                    stroke="var(--accent)"
                    strokeWidth=".7"
                    strokeDasharray="3 3"
                  />
                  <circle cx={p[0]} cy={p[1]} r="2" fill="var(--smoke)" />
                  <text x={p[0] + 5} y={p[1] - 5} className="map-label">
                    {ref.name}
                  </text>
                  <text
                    x={(p[0] + point[0]) / 2}
                    y={(p[1] + point[1]) / 2 - 4}
                    className="coord"
                  >
                    约 {Math.round(ref.distanceKm / 100) * 100} km
                  </text>
                </g>
              );
            })}
            <circle
              cx={point[0]}
              cy={point[1]}
              r="5"
              fill="var(--silk)"
              stroke="var(--accent)"
            />
            <circle cx={point[0]} cy={point[1]} r="2" fill="var(--accent)" />
            <text x={point[0] + 9} y={point[1] - 8} className="map-label">
              {card.name}
            </text>
          </>
        )}
        <path d="M20,161v5h60v-5" stroke="var(--ink-soft)" fill="none" />
        <text x="20" y="180" className="coord">
          0
        </text>
        <text x="80" y="180" textAnchor="end" className="coord">
          {km} km
        </text>
        <circle
          cx="294"
          cy="22"
          r="19"
          fill="var(--silk)"
          stroke="var(--map-border)"
        />
        <path d={globe(land) ?? ''} fill="var(--map-border)" />
        <path
          d={globe(grat) ?? ''}
          fill="none"
          stroke="var(--map-grat)"
          strokeWidth=".4"
        />
      </svg>
      {!located && <figcaption>没能确定这个地方的位置</figcaption>}
      {area && <figcaption>虚线为现代面积折算的等面积范围</figcaption>}
      {card.fact?.coordinateSource && (
        <figcaption>参照坐标：{card.fact.coordinateSource}</figcaption>
      )}
    </figure>
  );
}
