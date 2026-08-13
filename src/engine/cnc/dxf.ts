/**
 * DXF R12 ASCII writer (plan §8.3) — deliberately the oldest, simplest dialect,
 * because every CAM package on earth imports it without argument.
 * One layer per operation so VCarve/Fusion/Carbide Create can pick them apart.
 */

import { IN, MM, type Nm } from '../units';
import type { Ring } from '../geometry/polygon';
import type { Operation } from './toolpath';
import { outlineToRing, type Outline } from '../geometry/outline';

interface DxfLayer {
  name: string;
  color: number; // AutoCAD color index
  paths: Ring[];
  closed: boolean;
}

const g = (code: number, value: string | number): string => `${code}\n${value}`;

function coord(nm: Nm, units: 'in' | 'mm'): string {
  return (nm / (units === 'in' ? IN : MM)).toFixed(6);
}

function lwpolyline(path: Ring, layer: string, closed: boolean, units: 'in' | 'mm'): string[] {
  const out: string[] = [
    g(0, 'POLYLINE'),
    g(8, layer),
    g(66, 1),
    g(10, '0.0'),
    g(20, '0.0'),
    g(30, '0.0'),
    g(70, closed ? 1 : 0),
  ];
  for (const p of path) {
    out.push(g(0, 'VERTEX'), g(8, layer), g(10, coord(p.x, units)), g(20, coord(-p.y, units)), g(30, '0.0'));
  }
  out.push(g(0, 'SEQEND'), g(8, layer));
  return out;
}

/**
 * Compose a DXF document. Y is negated so the drawing reads the same way up in
 * CAM as it does on screen (board space is y-down, DXF is y-up).
 */
export function writeDxf(layers: DxfLayer[], units: 'in' | 'mm' = 'in'): string {
  const body: string[] = [];

  // HEADER — units only; everything else is defaulted
  body.push(
    g(0, 'SECTION'),
    g(2, 'HEADER'),
    g(9, '$INSUNITS'),
    g(70, units === 'in' ? 1 : 4),
    g(9, '$MEASUREMENT'),
    g(70, units === 'in' ? 0 : 1),
    g(0, 'ENDSEC'),
  );

  // TABLES — layer definitions
  body.push(g(0, 'SECTION'), g(2, 'TABLES'), g(0, 'TABLE'), g(2, 'LAYER'), g(70, layers.length));
  for (const l of layers) {
    body.push(g(0, 'LAYER'), g(2, l.name), g(70, 0), g(62, l.color), g(6, 'CONTINUOUS'));
  }
  body.push(g(0, 'ENDTAB'), g(0, 'ENDSEC'));

  // ENTITIES
  body.push(g(0, 'SECTION'), g(2, 'ENTITIES'));
  for (const l of layers) {
    for (const path of l.paths) {
      if (path.length < 2) continue;
      body.push(...lwpolyline(path, l.name, l.closed, units));
    }
  }
  body.push(g(0, 'ENDSEC'), g(0, 'EOF'));

  return body.join('\n') + '\n';
}

const LAYER_COLORS: Record<string, number> = {
  outline: 7, // white/black
  profile: 1, // red
  groove: 5, // blue
  pocket: 3, // green
  engrave: 6, // magenta
};

/** The board outline plus every generated toolpath, one layer each. */
export function toolpathsToDxf(
  outline: Outline,
  operations: Operation[],
  units: 'in' | 'mm' = 'in',
): string {
  const layers: DxfLayer[] = [
    { name: 'outline', color: LAYER_COLORS.outline, paths: [outlineToRing(outline)], closed: true },
  ];
  for (const op of operations) {
    if (op.paths.length === 0) continue;
    layers.push({
      name: op.kind,
      color: LAYER_COLORS[op.kind] ?? 7,
      paths: op.paths,
      closed: op.kind !== 'engrave',
    });
  }
  return writeDxf(layers, units);
}

/** Same paths as a flat SVG, for anyone who prefers vector import. */
export function toolpathsToSvg(outline: Outline, operations: Operation[], pxPerIn = 96): string {
  const s = pxPerIn / IN;
  const ring = outlineToRing(outline);
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const w = (Math.max(...xs) - Math.min(...xs)) * s;
  const h = (Math.max(...ys) - Math.min(...ys)) * s;
  const pad = 12;

  const pathData = (r: Ring, closed: boolean) =>
    `M${r.map((p) => `${(p.x * s).toFixed(2)},${(p.y * s).toFixed(2)}`).join('L')}${closed ? 'Z' : ''}`;

  const colors: Record<string, string> = {
    profile: '#c0392b',
    groove: '#2471a3',
    pocket: '#1e8449',
    engrave: '#8e44ad',
  };

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${(w + pad * 2).toFixed(0)}" height="${(h + pad * 2).toFixed(0)}" viewBox="${-pad} ${-pad} ${(w + pad * 2).toFixed(0)} ${(h + pad * 2).toFixed(0)}">`;
  out += `<g fill="none" stroke-width="1">`;
  out += `<path d="${pathData(ring, true)}" stroke="#333" stroke-dasharray="4,3"/>`;
  for (const op of operations) {
    const color = colors[op.kind] ?? '#555';
    for (const p of op.paths) {
      out += `<path d="${pathData(p, op.kind !== 'engrave')}" stroke="${color}"/>`;
    }
  }
  out += `</g></svg>`;
  return out;
}
