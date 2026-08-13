import { useMemo, useState } from 'react';
import { IN } from '../../engine/units';
import { cellQuadPoints } from '../../engine/construction/pipeline';
import type { PipelineResult } from '../../engine/construction/types';
import { isPlainRect, outlineToRing } from '../../engine/geometry/outline';
import { clipByConvex, type Ring } from '../../engine/geometry/polygon';
import { useContainerWidth, useSpeciesVisual } from '../hooks';
import type { SpeciesVisualLookup } from '../../exports/boardSvg';

/**
 * Rotatable 3-D preview, software-projected to SVG.
 *
 * The plan called for three.js. A cutting board is an extruded flat polygon —
 * six-ish faces, no curvature, no lighting model worth the name — so a direct
 * projection gives the same answer for a few hundred lines instead of a 600 KB
 * dependency, and it prints and exports as vector like everything else here.
 * Faces are painted back-to-front, which is exact for a convex slab.
 */
export function Preview3D({ result }: { result: PipelineResult }) {
  const [az, setAz] = useState(-32); // azimuth°
  const [el, setEl] = useState(58); // elevation°
  const visual = useSpeciesVisual();
  const [ref, width] = useContainerWidth<HTMLDivElement>();

  const svg = useMemo(
    () => renderIsometric(result, visual, az, el, Math.max(320, Math.min(width - 40, 760))),
    [result, visual, az, el, width],
  );

  return (
    <div className="canvas-stage" ref={ref}>
      <div className="preview3d" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="preview3d-controls">
        <label>
          <span>Turn</span>
          <input type="range" min={-180} max={180} value={az} onChange={(e) => setAz(Number(e.target.value))} />
        </label>
        <label>
          <span>Tilt</span>
          <input type="range" min={12} max={88} value={el} onChange={(e) => setEl(Number(e.target.value))} />
        </label>
        <button onClick={() => { setAz(-32); setEl(58); }}>Reset</button>
      </div>
      <p className="hint">
        Colours come from each species' representative tone — real lumber varies, so treat this as a layout check rather
        than a colour match.
      </p>
    </div>
  );
}

type P3 = { x: number; y: number; z: number };

/** Project a board-space point (nm, y-down) plus height z into screen px. */
function makeProjector(azDeg: number, elDeg: number, scale: number) {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const se = Math.sin(e);
  const ce = Math.cos(e);
  return (p: P3) => {
    // rotate about the vertical axis, then tilt toward the viewer
    const x = p.x * ca - p.y * sa;
    const y = p.x * sa + p.y * ca;
    return {
      x: x * scale,
      y: (y * se - p.z * ce) * scale,
      // depth key for painter's ordering: larger = nearer the viewer
      d: y * ce + p.z * se,
    };
  };
}

function renderIsometric(
  result: PipelineResult,
  visual: SpeciesVisualLookup,
  az: number,
  el: number,
  widthPx: number,
): string {
  const L = result.grid.boardLength;
  const W = result.grid.boardWidth;
  const T = result.finished.thickness;
  if (L <= 0 || W <= 0) return '';

  const shaped = !isPlainRect(result.outline);
  const outlineRing: Ring = shaped
    ? outlineToRing(result.outline)
    : [
        { x: 0, y: 0 },
        { x: L, y: 0 },
        { x: L, y: W },
        { x: 0, y: W },
      ];

  // scale so the widest projection fits the box
  const diag = Math.hypot(L, W);
  const scale = (widthPx * 0.82) / diag / 1;
  const project = makeProjector(az, el, scale / IN * IN); // scale is px per nm
  const cx = L / 2;
  const cy = W / 2;
  const P = (x: number, y: number, z: number) => project({ x: x - cx, y: y - cy, z });

  interface Face {
    pts: { x: number; y: number }[];
    fill: string;
    stroke: string;
    depth: number;
  }
  const faces: Face[] = [];

  const shade = (hex: string, k: number) => {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round((((n >> 16) & 255) * k));
    const g = Math.round((((n >> 8) & 255) * k));
    const b = Math.round(((n & 255) * k));
    const c = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  };

  /* ---- side walls: one quad per outline edge, extruded down ---- */
  for (let i = 0; i < outlineRing.length; i++) {
    const a = outlineRing[i];
    const b = outlineRing[(i + 1) % outlineRing.length];
    const p1 = P(a.x, a.y, T);
    const p2 = P(b.x, b.y, T);
    const p3 = P(b.x, b.y, 0);
    const p4 = P(a.x, a.y, 0);
    // edge species: whichever cell the edge midpoint sits in (approximate but
    // stable — the edge shows end grain of that piece)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const hex = speciesAt(result, mid, visual);
    faces.push({
      pts: [p1, p2, p3, p4],
      fill: shade(hex, 0.62),
      stroke: shade(hex, 0.45),
      depth: Math.min(p1.d, p2.d) - 1e9, // walls always behind the top face
    });
  }

  /* ---- top face: every cell, clipped to the outline ---- */
  const pushTop = (pts: { x: number; y: number }[], hex: string) => {
    const clipped = shaped ? clipByConvex(outlineRing, pts) : pts;
    if (clipped.length < 3) return;
    const proj = clipped.map((p) => P(p.x, p.y, T));
    faces.push({
      pts: proj,
      fill: hex,
      stroke: shade(hex, 0.72),
      depth: 1e12, // top always paints last
    });
  };

  for (const poly of result.grid.polys ?? []) {
    pushTop(poly.points, visual(poly.species).hex);
  }
  for (let ri = 0; ri < result.grid.rows.length; ri++) {
    const row = result.grid.rows[ri];
    for (let ci = 0; ci < row.cells.length; ci++) {
      pushTop(cellQuadPoints(result.grid, ri, ci), visual(row.cells[ci].species).hex);
    }
  }

  faces.sort((a, b) => a.depth - b.depth);

  // fit the viewbox to the projected geometry
  const all = faces.flatMap((f) => f.pts);
  if (all.length === 0) return '';
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const pad = 16;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${vbW.toFixed(0)}" height="${vbH.toFixed(0)}" viewBox="${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}">`;
  for (const f of faces) {
    const d = `M${f.pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z`;
    out += `<path d="${d}" fill="${f.fill}" stroke="${f.stroke}" stroke-width="0.5" stroke-linejoin="round"/>`;
  }
  out += `</svg>`;
  return out;
}

/** Species colour at a board-space point — used to tint the extruded edges. */
function speciesAt(result: PipelineResult, p: { x: number; y: number }, visual: SpeciesVisualLookup): string {
  for (const poly of result.grid.polys ?? []) {
    if (pointInPoly(p, poly.points)) return visual(poly.species).hex;
  }
  for (let ri = 0; ri < result.grid.rows.length; ri++) {
    const row = result.grid.rows[ri];
    for (let ci = 0; ci < row.cells.length; ci++) {
      if (pointInPoly(p, cellQuadPoints(result.grid, ri, ci))) return visual(row.cells[ci].species).hex;
    }
  }
  return '#c9b18c';
}

function pointInPoly(p: { x: number; y: number }, ring: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
