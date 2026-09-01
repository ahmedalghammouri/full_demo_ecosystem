'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { stateColor, stateLabel, fmtNumber } from '@/lib/machine-state';

/**
 * 2.5D digital twin of the plant floor.
 *
 * Each asset is drawn as an extruded box in its floor-plan position, so
 * the screen reads as the facility rather than as a chart. The projection
 * is a standard 2:1 isometric — cheap, exact, and it keeps every cell the
 * same visual weight regardless of where it sits, which a perspective
 * view would not.
 *
 * Colour on the box top carries SOW 7.2 state, and every box ships its
 * code as a text label, so state is never colour-alone.
 */

const TILE = 34; // half-width of one grid unit in screen px
const LIFT = 15; // extrusion height per unit of box height

/** Isometric projection of a floor-plan point. */
function iso(x: number, y: number): [number, number] {
  return [(x - y) * TILE, (x + y) * (TILE / 2)];
}

export interface TwinAsset {
  code: string;
  name: string;
  nameAr?: string | null;
  kind: string;
  sequence: number;
  grid: { x: number; y: number; w: number; h: number };
  state: string;
  producing: boolean;
  alarms: number;
  headline: { label: string; value: number | null; unit: string } | null;
  goodCount: number;
}

export function PlantTwin({
  assets,
  selected,
  onSelect,
  className,
}: {
  assets: TwinAsset[];
  selected?: string | null;
  onSelect?: (code: string) => void;
  className?: string;
}) {
  const [hover, setHover] = React.useState<string | null>(null);

  // Fit the viewBox to whatever the plant model actually occupies, so
  // adding a cell never pushes the drawing off the canvas.
  const bounds = React.useMemo(() => {
    if (!assets.length) return { minX: -400, minY: -60, w: 1200, h: 560 };
    const pts: Array<[number, number]> = [];
    for (const a of assets) {
      const { x, y, w, h } = a.grid;
      for (const [px, py] of [
        [x, y], [x + w, y], [x, y + h], [x + w, y + h],
      ] as Array<[number, number]>) {
        const [sx, sy] = iso(px, py);
        pts.push([sx, sy]);
        pts.push([sx, sy - 3 * LIFT]); // room for the tallest extrusion + label
      }
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const pad = 70;
    return {
      minX: Math.min(...xs) - pad,
      minY: Math.min(...ys) - pad - 22,
      w: Math.max(...xs) - Math.min(...xs) + pad * 2,
      h: Math.max(...ys) - Math.min(...ys) + pad * 2 + 22,
    };
  }, [assets]);

  // Painter's algorithm: draw far boxes first so near ones overlap them.
  const ordered = React.useMemo(
    () => [...assets].sort((a, b) => a.grid.x + a.grid.y - (b.grid.x + b.grid.y)),
    [assets],
  );

  const hovered = ordered.find((a) => a.code === hover);

  return (
    <div className={cn('relative w-full', className)}>
      <div className="scroll-x">
        <svg
          viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`}
          className="twin-canvas w-full"
          style={{ minWidth: 620, minHeight: 360 }}
          role="img"
          aria-label="Digital twin of the plant floor"
        >
          <defs>
            {/* Floor grid, drawn in isometric so it reads as a floor. */}
            <pattern
              id="twin-floor"
              width={TILE * 2}
              height={TILE}
              patternUnits="userSpaceOnUse"
              patternTransform={`skewY(-26.57) `}
            >
              <rect width={TILE * 2} height={TILE} fill="none" />
              <path
                d={`M0 0 H${TILE * 2} M0 0 V${TILE}`}
                stroke="var(--line)"
                strokeWidth="1"
                opacity="0.5"
              />
            </pattern>
          </defs>

          {/* Floor slab */}
          <FloorSlab assets={assets} />

          {ordered.map((a) => (
            <AssetBox
              key={a.code}
              asset={a}
              active={selected === a.code}
              hovered={hover === a.code}
              onHover={setHover}
              onSelect={onSelect}
            />
          ))}
        </svg>
      </div>

      {/* Hover card — anchored to the panel, not to the cursor, so it never
          leaves the container on a narrow screen. */}
      {hovered && (
        <div className="pointer-events-none absolute bottom-3 start-3 z-20 w-[230px] rounded-md border border-border bg-popover/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">{hovered.name}</p>
              <p className="readout text-[10px] text-muted-foreground">{hovered.code}</p>
            </div>
            <span
              className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
              style={{ background: stateColor(hovered.state) }}
            />
          </div>
          <dl className="mt-2 space-y-1 text-[11px]">
            <Row label="State" value={stateLabel(hovered.state)} />
            {hovered.headline && (
              <Row
                label={hovered.headline.label}
                value={
                  hovered.headline.value != null
                    ? `${fmtNumber(hovered.headline.value, 1)} ${hovered.headline.unit}`
                    : '—'
                }
              />
            )}
            {hovered.alarms > 0 && <Row label="Active alarms" value={String(hovered.alarms)} danger />}
          </dl>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className={cn('readout shrink-0 font-medium', danger && 'text-danger-500')}>{value}</dd>
    </div>
  );
}

/** The slab the plant sits on, sized to the model's extent. */
function FloorSlab({ assets }: { assets: TwinAsset[] }) {
  if (!assets.length) return null;
  const xs = assets.flatMap((a) => [a.grid.x, a.grid.x + a.grid.w]);
  const ys = assets.flatMap((a) => [a.grid.y, a.grid.y + a.grid.h]);
  const x0 = Math.min(...xs) - 1.2;
  const x1 = Math.max(...xs) + 1.2;
  const y0 = Math.min(...ys) - 1.2;
  const y1 = Math.max(...ys) + 1.2;

  const corners = [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)];
  const points = corners.map((c) => c.join(',')).join(' ');

  return (
    <g>
      <polygon points={points} fill="var(--surface-sunk)" stroke="var(--line)" strokeWidth="1.5" />
      {/* Aisle lines along the process flow, west to east. */}
      {Array.from({ length: Math.ceil(y1 - y0) }, (_, i) => {
        const y = y0 + i + 1;
        const [ax, ay] = iso(x0, y);
        const [bx, by] = iso(x1, y);
        return <line key={`h${i}`} x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--line)" strokeWidth="0.75" opacity="0.55" />;
      })}
      {Array.from({ length: Math.ceil(x1 - x0) }, (_, i) => {
        const x = x0 + i + 1;
        const [ax, ay] = iso(x, y0);
        const [bx, by] = iso(x, y1);
        return <line key={`v${i}`} x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--line)" strokeWidth="0.75" opacity="0.55" />;
      })}
    </g>
  );
}

/**
 * One extruded box.
 *
 * Three faces: top carries the state colour, the two side faces are the
 * same hue darkened, so the solid reads as a solid without a gradient.
 */
function AssetBox({
  asset,
  active,
  hovered,
  onHover,
  onSelect,
}: {
  asset: TwinAsset;
  active: boolean;
  hovered: boolean;
  onHover: (code: string | null) => void;
  onSelect?: (code: string) => void;
}) {
  const { x, y, w, h } = asset.grid;
  // Tall cells for the big machines, low for the support cells, so the
  // floor plan has the silhouette of the real plant.
  const height =
    asset.kind === 'OVEN' || asset.kind === 'FILAMENT_WINDING' ? 2.6
    : asset.kind === 'BLOW_MOLDING' || asset.kind === 'INJECTION_MOLDING' ? 2.0
    : asset.kind === 'LABORATORY' ? 1.5
    : 1.7;

  const lift = height * LIFT;
  const color = stateColor(asset.state);

  // Footprint corners
  const A = iso(x, y);
  const B = iso(x + w, y);
  const C = iso(x + w, y + h);
  const D = iso(x, y + h);

  // Top face is the footprint raised by `lift`
  const tA: [number, number] = [A[0], A[1] - lift];
  const tB: [number, number] = [B[0], B[1] - lift];
  const tC: [number, number] = [C[0], C[1] - lift];
  const tD: [number, number] = [D[0], D[1] - lift];

  const poly = (pts: Array<[number, number]>) => pts.map((p) => p.join(',')).join(' ');

  const centreTop = [(tA[0] + tC[0]) / 2, (tA[1] + tC[1]) / 2];

  return (
    <g
      className="twin-hit"
      onMouseEnter={() => onHover(asset.code)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect?.(asset.code)}
      opacity={hovered || active ? 1 : 0.95}
    >
      {/* Right face (the +x side) */}
      <polygon points={poly([B, C, tC, tB])} fill={color} fillOpacity={0.42} stroke={color} strokeWidth="0.8" />
      {/* Front face (the +y side) */}
      <polygon points={poly([C, D, tD, tC])} fill={color} fillOpacity={0.24} stroke={color} strokeWidth="0.8" />
      {/* Top face */}
      <polygon
        points={poly([tA, tB, tC, tD])}
        fill={color}
        fillOpacity={asset.producing ? 0.88 : 0.62}
        stroke={active || hovered ? 'var(--ink)' : color}
        strokeWidth={active || hovered ? 2 : 1}
      />

      {/* Alarm marker — a shape, not only a colour. */}
      {asset.alarms > 0 && (
        <g>
          <circle cx={centreTop[0]} cy={centreTop[1] - 12} r="8" fill="var(--status-critical)" />
          <text
            x={centreTop[0]}
            y={centreTop[1] - 12}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="10"
            fontWeight="700"
            fill="#fff"
          >
            !
          </text>
        </g>
      )}

      {/* Label — the code always, so identity never depends on the fill. */}
      <text
        x={centreTop[0]}
        y={centreTop[1] + 4}
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill="var(--ink)"
        style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3 }}
      >
        {asset.code}
      </text>

      {/* Headline reading beside the machine, as in the proposal's twin. */}
      {asset.headline?.value != null && (
        <text
          x={centreTop[0]}
          y={centreTop[1] + 17}
          textAnchor="middle"
          fontSize="9"
          fill="var(--ink-muted)"
          style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3 }}
        >
          {fmtNumber(asset.headline.value, 1)} {asset.headline.unit}
        </text>
      )}
    </g>
  );
}

/** State legend — every colour on the twin, named. */
export function TwinLegend({ states }: { states: Array<{ key: string; label: string; count?: number }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {states.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: stateColor(s.key) }}
          />
          <span className="whitespace-nowrap">{s.label}</span>
          {s.count !== undefined && <span className="tabular font-medium text-foreground">{s.count}</span>}
        </span>
      ))}
    </div>
  );
}
