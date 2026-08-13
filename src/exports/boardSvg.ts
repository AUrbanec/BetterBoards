/**
 * Board rendering: cell grid → SVG. Used by the live canvas AND the blueprint
 * pages, so the preview and the printed drawing can never disagree.
 * All quads derive from the exact grid; floats appear only here (render).
 */

import { IN } from '../engine/units';
import type { CellGrid, GridRow } from '../engine/construction/types';
import { escapeXml } from './shared';

export interface SpeciesVisual {
  hex: string;
  tint: [string, string];
  letter: string;
  name: string;
}

export type SpeciesVisualLookup = (id: string) => SpeciesVisual;

export interface BoardSvgOptions {
  pxPerIn: number;
  showLabels?: boolean;
  showGlueLines?: boolean;
  /** id prefix so several boards can share one document */
  idPrefix?: string;
}

type Pt = [number, number];

/** Board-space quad (nm floats) for one cell. */
export function cellQuad(grid: CellGrid, row: GridRow, cellIndex: number): Pt[] {
  const c = row.cells[cellIndex];
  switch (grid.map.kind) {
    case 'rows-y': {
      // u→x, v→y
      return [
        [c.u0, row.v0],
        [c.u1, row.v0],
        [c.u1, row.v1],
        [c.u0, row.v1],
      ];
    }
    case 'rows-x': {
      // v→x, u→y (+shear drift across the row)
      const h = row.v1 - row.v0;
      const y0 = c.u0 * row.scale - row.offset;
      const y1 = c.u1 * row.scale - row.offset;
      const d = row.shear * h;
      return [
        [row.v0, y0],
        [row.v1, y0 + d],
        [row.v1, y1 + d],
        [row.v0, y1],
      ];
    }
    case 'diag': {
      const a = (grid.map.angleDeg * Math.PI) / 180;
      const dir: Pt = [Math.cos(a), Math.sin(a)];
      const nrm: Pt = [-Math.sin(a), Math.cos(a)];
      const rows = gridRowsExtent(grid);
      const cx = grid.boardLength / 2;
      const cy = grid.boardWidth / 2;
      const at = (v: number, t: number): Pt => [
        cx + nrm[0] * (v - rows / 2 + row.offset) + dir[0] * t,
        cy + nrm[1] * (v - rows / 2 + row.offset) + dir[1] * t,
      ];
      const t0 = c.u0 - row.run / 2;
      const t1 = c.u1 - row.run / 2;
      return [at(row.v0, t0), at(row.v0, t1), at(row.v1, t1), at(row.v1, t0)];
    }
  }
}

function gridRowsExtent(grid: CellGrid): number {
  return grid.rows.length ? grid.rows[grid.rows.length - 1].v1 : 0;
}

/** Deterministic per-cell jitter in [0,1) — seed = position, not Math.random. */
function jitter(rowIdx: number, cellIdx: number): number {
  let h = (rowIdx * 73856093) ^ (cellIdx * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Render the board (defs + cells + outline) as an SVG fragment positioned at
 * (0,0) with size boardLength×boardWidth in px. Wrap in a <g transform> to place.
 */
export function renderBoardGroup(
  grid: CellGrid,
  visual: SpeciesVisualLookup,
  opts: BoardSvgOptions,
): { defs: string; body: string; widthPx: number; heightPx: number } {
  const s = opts.pxPerIn / IN; // nm → px
  const W = grid.boardLength * s;
  const H = grid.boardWidth * s;
  const pre = opts.idPrefix ?? 'bb';
  const showGlue = opts.showGlueLines ?? true;

  // species defs: grain stripe patterns along the grain direction
  const speciesIds = new Set<string>();
  for (const row of grid.rows) for (const c of row.cells) speciesIds.add(c.species);
  const grainAngle = grid.map.kind === 'rows-y' ? 0 : grid.map.kind === 'rows-x' ? 90 : grid.map.angleDeg;
  let defs = `<clipPath id="${pre}-clip"><rect x="0" y="0" width="${W.toFixed(2)}" height="${H.toFixed(2)}"/></clipPath>`;
  for (const id of speciesIds) {
    const v = visual(id);
    defs += `<pattern id="${pre}-grain-${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(${grainAngle})">` +
      `<rect width="7" height="7" fill="${v.hex}"/>` +
      `<rect width="7" height="1.3" y="1" fill="${v.tint[1]}" opacity="0.35"/>` +
      `<rect width="7" height="0.7" y="4.4" fill="${v.tint[0]}" opacity="0.5"/>` +
      `</pattern>`;
  }

  let body = `<g clip-path="url(#${pre}-clip)">`;
  // background (shows through if angled coverage has gaps — makes problems visible)
  body += `<rect x="0" y="0" width="${W.toFixed(2)}" height="${H.toFixed(2)}" fill="#f3ede2"/>`;

  const labels: string[] = [];
  grid.rows.forEach((row, ri) => {
    row.cells.forEach((c, ci) => {
      const quad = cellQuad(grid, row, ci).map(([x, y]) => [x * s, y * s] as Pt);
      const d = `M${quad.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L')}Z`;
      const v = visual(c.species);
      const j = jitter(ri, ci);
      const shade = 0.92 + j * 0.13; // subtle per-piece brightness variation
      body += `<path d="${d}" fill="${v.hex}"/>`;
      body += `<path d="${d}" fill="url(#${pre}-grain-${c.species})" opacity="${(0.5 * shade).toFixed(3)}"/>`;
      if (shade < 1) body += `<path d="${d}" fill="#2b1d0e" opacity="${((1 - shade) * 0.35).toFixed(3)}"/>`;
      if (showGlue) body += `<path d="${d}" fill="none" stroke="#3a2c1a" stroke-opacity="0.45" stroke-width="0.7"/>`;
      if (opts.showLabels) {
        const cx = quad.reduce((t, p) => t + p[0], 0) / 4;
        const cy = quad.reduce((t, p) => t + p[1], 0) / 4;
        const minSide = Math.min(
          Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]),
          Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]),
        );
        if (minSide > 14) {
          labels.push(
            `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-size="${Math.min(13, minSide * 0.45).toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="#1a120a" opacity="0.55" font-family="ui-monospace, monospace">${escapeXml(v.letter)}</text>`,
          );
        }
      }
    });
  });
  body += labels.join('');
  body += `</g>`;
  body += `<rect x="0" y="0" width="${W.toFixed(2)}" height="${H.toFixed(2)}" fill="none" stroke="#241809" stroke-width="1.4"/>`;

  return { defs, body, widthPx: W, heightPx: H };
}

/** Standalone SVG document of just the board. */
export function renderBoardSvg(
  grid: CellGrid,
  visual: SpeciesVisualLookup,
  opts: BoardSvgOptions,
): string {
  const g = renderBoardGroup(grid, visual, opts);
  const pad = 4;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${(g.widthPx + pad * 2).toFixed(0)}" height="${(g.heightPx + pad * 2).toFixed(0)}" viewBox="${-pad} ${-pad} ${(g.widthPx + pad * 2).toFixed(0)} ${(g.heightPx + pad * 2).toFixed(0)}">` +
    `<defs>${g.defs}</defs><g>${g.body}</g></svg>`
  );
}
