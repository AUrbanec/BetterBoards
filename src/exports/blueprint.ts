/**
 * Blueprint composer (§8.1): multi-page SVG documents sized for print.
 * Page 1 — finished board, to scale, with dimension lines & legend
 * Page 2 — glue-up #1 diagram + rip schedule
 * Page 3 — crosscut & arrangement (end grain only)
 * Page 4 — cut list & materials tables
 * Convert to PDF via the browser's print dialog (vector-exact) or save as SVG.
 */

import { IN, formatCutDim, formatDim, type UnitMode } from '../engine/units';
import { speciesAreas } from '../engine/construction/pipeline';
import { isPlainRect, outlineToPath } from '../engine/geometry/outline';
import { area as ringArea } from '../engine/geometry/polygon';
import { outlineToRing } from '../engine/geometry/outline';
import type { BoardSpec, PipelineResult } from '../engine/construction/types';
import type { CutList, SpeciesInfoLookup } from '../engine/cutlist/cutlist';
import type { Lint } from '../engine/validate/rules';
import { escapeXml, formatSliceList, speciesLetters } from './shared';
import { renderBoardGroup, type SpeciesVisualLookup } from './boardSvg';

export type PageSize = 'letter' | 'a4';

const PAGES: Record<PageSize, { w: number; h: number }> = {
  letter: { w: 816, h: 1056 }, // 8.5×11 @96dpi
  a4: { w: 794, h: 1123 },
};
const MARGIN = 56;
const INK = '#1c2733';
const FAINT = '#5a6b7c';
const FONT = 'font-family="Helvetica, Arial, sans-serif"';
const MONO = 'font-family="ui-monospace, Menlo, Consolas, monospace"';

interface Ctx {
  board: BoardSpec;
  result: PipelineResult;
  cutlist: CutList;
  lints: Lint[];
  visual: SpeciesVisualLookup;
  info: SpeciesInfoLookup;
  units: UnitMode;
  page: { w: number; h: number };
}

const f = (ctx: Ctx) => (nm: number) => formatCutDim(nm, ctx.units);
const fd = (ctx: Ctx) => (nm: number) => formatDim(nm, ctx.units);

function pageSvg(ctx: Ctx, title: string, pageNo: number, total: number, content: string): string {
  const { w, h } = ctx.page;
  const date = new Date().toISOString().slice(0, 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="white"/>` +
    // frame + title block
    `<rect x="${MARGIN - 16}" y="${MARGIN - 16}" width="${w - 2 * (MARGIN - 16)}" height="${h - 2 * (MARGIN - 16)}" fill="none" stroke="${INK}" stroke-width="1.2"/>` +
    `<text x="${MARGIN}" y="${MARGIN + 10}" ${FONT} font-size="19" font-weight="bold" fill="${INK}">${escapeXml(ctx.board.name)}</text>` +
    `<text x="${MARGIN}" y="${MARGIN + 28}" ${FONT} font-size="11" fill="${FAINT}">${escapeXml(title)}</text>` +
    `<text x="${w - MARGIN}" y="${MARGIN + 10}" ${FONT} font-size="11" text-anchor="end" fill="${FAINT}">BetterBoards · ${date}</text>` +
    `<text x="${w - MARGIN}" y="${MARGIN + 26}" ${FONT} font-size="11" text-anchor="end" fill="${FAINT}">page ${pageNo} / ${total}</text>` +
    `<line x1="${MARGIN - 16}" y1="${MARGIN + 40}" x2="${w - MARGIN + 16}" y2="${MARGIN + 40}" stroke="${INK}" stroke-width="1.2"/>` +
    content +
    `</svg>`
  );
}

/* ---------------- dimension line helpers ---------------- */

function arrow(x: number, y: number, angleDeg: number): string {
  return `<path d="M0,0L-7,2.6L-7,-2.6Z" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${angleDeg})" fill="${INK}"/>`;
}

export function dimH(x0: number, x1: number, y: number, label: string, extUp = 10): string {
  const t = `<text x="${((x0 + x1) / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" ${FONT} font-size="11" text-anchor="middle" fill="${INK}">${escapeXml(label)}</text>`;
  return (
    `<g stroke="${INK}" stroke-width="0.9">` +
    `<line x1="${x0}" y1="${y - extUp}" x2="${x0}" y2="${y + 4}"/>` +
    `<line x1="${x1}" y1="${y - extUp}" x2="${x1}" y2="${y + 4}"/>` +
    `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>` +
    `</g>` + arrow(x0, y, 180) + arrow(x1, y, 0) + t
  );
}

export function dimV(x: number, y0: number, y1: number, label: string, extLeft = 10): string {
  const t = `<text x="${(x + 5).toFixed(1)}" y="${((y0 + y1) / 2).toFixed(1)}" ${FONT} font-size="11" fill="${INK}" transform="rotate(90 ${(x + 5).toFixed(1)} ${((y0 + y1) / 2).toFixed(1)})" text-anchor="middle">${escapeXml(label)}</text>`;
  return (
    `<g stroke="${INK}" stroke-width="0.9">` +
    `<line x1="${x - extLeft}" y1="${y0}" x2="${x + 4}" y2="${y0}"/>` +
    `<line x1="${x - extLeft}" y1="${y1}" x2="${x + 4}" y2="${y1}"/>` +
    `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>` +
    `</g>` + arrow(x, y0, 270) + arrow(x, y1, 90) + t
  );
}

/* ---------------- table helper ---------------- */

/** Break text into at most `maxLines` lines of ≤ `perLine` characters. */
function wrapText(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > perLine) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines) {
    const consumed = lines.join(' ').length;
    if (consumed < text.length - 1) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, '')}…`;
  }
  return lines;
}

/** Truncate to fit a column: the tables render in 10.5px monospace (~6.4px/char). */
function clip(text: string, widthPx: number): string {
  const max = Math.max(3, Math.floor((widthPx - 6) / 6.4));
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function table(
  x: number,
  y: number,
  cols: { header: string; width: number; align?: 'start' | 'end' }[],
  rows: string[][],
  title?: string,
): { svg: string; height: number } {
  const rowH = 17;
  let svg = '';
  let yy = y;
  if (title) {
    svg += `<text x="${x}" y="${yy}" ${FONT} font-size="12.5" font-weight="bold" fill="${INK}">${escapeXml(title)}</text>`;
    yy += 8;
  }
  const totalW = cols.reduce((t, c) => t + c.width, 0);
  // header
  let cx = x;
  yy += rowH;
  svg += `<line x1="${x}" y1="${yy - rowH + 4}" x2="${x + totalW}" y2="${yy - rowH + 4}" stroke="${INK}" stroke-width="0.8"/>`;
  for (const c of cols) {
    const tx = c.align === 'end' ? cx + c.width - 4 : cx + 2;
    svg += `<text x="${tx}" y="${yy - 4}" ${FONT} font-size="10.5" font-weight="bold" fill="${FAINT}" text-anchor="${c.align === 'end' ? 'end' : 'start'}">${escapeXml(c.header)}</text>`;
    cx += c.width;
  }
  svg += `<line x1="${x}" y1="${yy + 1}" x2="${x + totalW}" y2="${yy + 1}" stroke="${INK}" stroke-width="0.8"/>`;
  for (const row of rows) {
    yy += rowH;
    cx = x;
    row.forEach((cell, i) => {
      const c = cols[i];
      const tx = c.align === 'end' ? cx + c.width - 4 : cx + 2;
      svg += `<text x="${tx}" y="${yy - 4}" ${MONO} font-size="10.5" fill="${INK}" text-anchor="${c.align === 'end' ? 'end' : 'start'}">${escapeXml(cell)}</text>`;
      cx += c.width;
    });
    svg += `<line x1="${x}" y1="${yy + 1}" x2="${x + totalW}" y2="${yy + 1}" stroke="${FAINT}" stroke-width="0.3"/>`;
  }
  return { svg, height: yy - y + 6 };
}

/* ---------------- page 1: finished board ---------------- */

function page1(ctx: Ctx): string {
  const { result, page } = ctx;
  const fmt = f(ctx);
  const contentTop = MARGIN + 64;
  const availW = page.w - 2 * MARGIN - 60;
  const availH = page.h * 0.5 - contentTop;

  // pick a clean scale 1:N
  const boardWIn = result.grid.boardLength / IN;
  const boardHIn = result.grid.boardWidth / IN;
  const pxPerInAt1 = 96;
  let scaleN = 1;
  for (const n of [1, 1.5, 2, 3, 4, 6, 8, 12, 16]) {
    scaleN = n;
    if ((boardWIn * pxPerInAt1) / n <= availW && (boardHIn * pxPerInAt1) / n <= availH) break;
  }
  const pxPerIn = pxPerInAt1 / scaleN;

  const g = renderBoardGroup(result.grid, ctx.visual, {
    pxPerIn,
    showLabels: true,
    idPrefix: 'p1',
    outline: result.outline,
    showBlank: true,
  });
  const bx = MARGIN + 30 + (availW - g.widthPx) / 2;
  const by = contentTop + 30;

  let content = `<defs>${g.defs}</defs>`;
  content += `<g transform="translate(${bx.toFixed(1)},${by.toFixed(1)})">${g.body}</g>`;
  content += dimH(bx, bx + g.widthPx, by - 14, fmt(result.grid.boardLength));
  content += dimV(bx + g.widthPx + 14, by, by + g.heightPx, fmt(result.grid.boardWidth));
  content += `<text x="${bx}" y="${by + g.heightPx + 24}" ${FONT} font-size="11" fill="${INK}">Thickness: ${fmt(result.finished.thickness)} · Scale 1:${scaleN} on ${ctx.page === PAGES.letter ? 'US Letter' : 'A4'} at 100% print size</text>`;

  // legend
  let ly = by + g.heightPx + 56;
  content += `<text x="${MARGIN}" y="${ly - 10}" ${FONT} font-size="12.5" font-weight="bold" fill="${INK}">Species legend</text>`;
  const letters = speciesLetters(ctx.board);
  // percentages are of the *finished* surface, so a shaped board's legend
  // reflects what you'll actually see, not the blank
  const { bySpecies: areas, total: totalArea } = speciesAreas(result);
  for (const [id, letter] of letters) {
    const v = ctx.visual(id);
    const share = totalArea ? ((areas.get(id) ?? 0) / totalArea) * 100 : 0;
    content += `<rect x="${MARGIN}" y="${ly}" width="26" height="15" fill="${v.hex}" stroke="${INK}" stroke-width="0.7"/>`;
    content += `<text x="${MARGIN + 13}" y="${ly + 11.5}" ${FONT} font-size="10" text-anchor="middle" fill="#1a120a" opacity="0.7">${letter}</text>`;
    content += `<text x="${MARGIN + 34}" y="${ly + 11.5}" ${FONT} font-size="11" fill="${INK}">${escapeXml(v.name)} — ${share.toFixed(0)}% of surface</text>`;
    ly += 21;
  }

  // warnings box
  const warnings = ctx.lints.filter((l) => l.level === 'warning');
  const errors = ctx.lints.filter((l) => l.level === 'error');
  if (warnings.length + errors.length > 0) {
    ly += 12;
    content += `<text x="${MARGIN}" y="${ly}" ${FONT} font-size="12.5" font-weight="bold" fill="#8a5a00">⚠ ${errors.length ? `${errors.length} error(s), ` : ''}${warnings.length} advisory warning(s)</text>`;
    ly += 6;
    for (const l of [...errors, ...warnings].slice(0, 5)) {
      // wrap on word boundaries rather than truncating mid-word
      for (const [i, line] of wrapText(l.message, 108, 2).entries()) {
        ly += 15;
        content += `<text x="${MARGIN + (i > 0 ? 8 : 0)}" y="${ly}" ${FONT} font-size="10" fill="${FAINT}">${i === 0 ? '• ' : ''}${escapeXml(line)}</text>`;
      }
    }
  }

  return content;
}

/* ---------------- page 2: glue-up #1 ---------------- */

function page2(ctx: Ctx): string {
  const { result, page } = ctx;
  const fmt = f(ctx);
  const g1 = result.glueUp1;
  const letters = speciesLetters(ctx.board);
  const contentTop = MARGIN + 70;

  // cross-section: strips on edge (x = cumulative width, height = stock thickness)
  const availW = page.w - 2 * MARGIN;
  const pxPerIn = Math.min(56, (availW / (g1.slabWidth / IN)));
  const sh = (g1.slabThickness / IN) * pxPerIn;
  const bx = MARGIN;
  const by = contentTop + 24;
  let x = bx;
  let content = `<text x="${MARGIN}" y="${contentTop}" ${FONT} font-size="12.5" font-weight="bold" fill="${INK}">Glue-up #1 — slab cross-section (looking down the strips)</text>`;
  for (const s of g1.strips) {
    const w = (s.width / IN) * pxPerIn;
    const v = ctx.visual(s.species);
    content += `<rect x="${x.toFixed(1)}" y="${by}" width="${w.toFixed(1)}" height="${sh.toFixed(1)}" fill="${v.hex}" stroke="${INK}" stroke-width="0.8"/>`;
    if (w > 13) {
      content += `<text x="${(x + w / 2).toFixed(1)}" y="${(by + sh / 2 + 3.5).toFixed(1)}" ${FONT} font-size="10.5" text-anchor="middle" fill="#1a120a" opacity="0.75">${letters.get(s.species)}</text>`;
    }
    x += w;
  }
  content += dimH(bx, x, by - 12, fmt(g1.slabWidth));
  content += dimV(x + 12, by, by + sh, fmt(g1.slabThickness));
  content += `<text x="${bx}" y="${by + sh + 20}" ${FONT} font-size="11" fill="${INK}">Strip length: ${fmt(g1.slabLength)} (includes ${fd(ctx)(ctx.board.cleanup.lengthTrim)} end trim). Flatten slab to ${fmt(g1.slabThicknessAfterPlaning)} after cure.</text>`;

  // rip schedule table
  const rows = ctx.cutlist.ripSchedule.map((g) => [
    `${letters.get(g.species) ?? ''}`,
    ctx.info(g.species)?.name ?? g.species,
    `${g.count}`,
    fmt(g.width),
    fmt(g.thickness),
    fmt(g.length),
  ]);
  const t = table(
    MARGIN,
    by + sh + 52,
    [
      { header: '', width: 24 },
      { header: 'Species', width: 190 },
      { header: 'Qty', width: 40, align: 'end' },
      { header: 'Width', width: 150, align: 'end' },
      { header: 'Thick', width: 110, align: 'end' },
      { header: 'Length', width: 160, align: 'end' },
    ],
    rows,
    'Rip schedule',
  );
  content += t.svg;

  const gm = ctx.cutlist.glue;
  const gy = by + sh + 52 + t.height + 26;
  content += `<text x="${MARGIN}" y="${gy}" ${FONT} font-size="11" fill="${INK}">Clamps: ${gm.glueUp1Clamps} for glue-up #1${gm.glueUp2Clamps ? `, ${gm.glueUp2Clamps} for glue-up #2` : ''} (one per 6–8″ of joint). Glue: ≈ ${Math.max(1, Math.ceil(gm.glueOzEstimate))} fl oz total.</text>`;
  return content;
}

/* ---------------- page 3: crosscut & arrangement ---------------- */

function page3(ctx: Ctx): string {
  const { result, page } = ctx;
  if (!result.crosscut) return '';
  const fmt = f(ctx);
  const cc = result.crosscut;
  const g1 = result.glueUp1;
  const letters = speciesLetters(ctx.board);
  const contentTop = MARGIN + 70;

  const availW = page.w - 2 * MARGIN;
  const pxPerIn = Math.min(30, availW / (g1.slabLength / IN));
  const bw = (g1.slabLength / IN) * pxPerIn;
  const bh = (g1.slabWidth / IN) * pxPerIn;
  const bx = MARGIN;
  const by = contentTop + 44; // leaves room for the slab dimension line above it

  let content = `<text x="${MARGIN}" y="${contentTop}" ${FONT} font-size="12.5" font-weight="bold" fill="${INK}">Crosscut plan — ${cc.sliceCount} slices at ${cc.angleDeg}°, each ${fmt(cc.sliceWidth)} wide</text>`;

  // slab with stripes horizontal
  let y = by;
  for (const s of g1.strips) {
    const h = (s.width / IN) * pxPerIn;
    const v = ctx.visual(s.species);
    content += `<rect x="${bx}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${v.hex}" stroke="${INK}" stroke-width="0.5"/>`;
    y += h;
  }
  // cut lines
  const sin = Math.sin((cc.angleDeg * Math.PI) / 180);
  const cot = cc.angleDeg === 90 ? 0 : Math.cos((cc.angleDeg * Math.PI) / 180) / sin;
  const advPx = (cc.advancePerSlice / IN) * pxPerIn;
  const wastePx = (cc.endWaste / IN) * pxPerIn;
  for (let i = 0; i <= cc.sliceCount; i++) {
    const xTop = bx + wastePx + i * advPx;
    const xBot = xTop - cot * bh;
    if (Math.max(xTop, xBot) > bx + bw + 1) break;
    content += `<line x1="${xTop.toFixed(1)}" y1="${by}" x2="${xBot.toFixed(1)}" y2="${(by + bh).toFixed(1)}" stroke="#c22" stroke-width="1" stroke-dasharray="5,3"/>`;
    if (i < cc.sliceCount) {
      // above the slab — numbers over dark stripes are unreadable
      content += `<text x="${(xTop + advPx / 2).toFixed(1)}" y="${by - 5}" ${FONT} font-size="9" text-anchor="middle" fill="#c22">${i + 1}</text>`;
    }
  }
  content += dimH(bx, bx + bw, by - 24, fmt(g1.slabLength));

  // arrangement diagram
  const ay = by + bh + 46;
  content += `<text x="${MARGIN}" y="${ay - 10}" ${FONT} font-size="12.5" font-weight="bold" fill="${INK}">Slice arrangement (in glue order)</text>`;
  const iconW = Math.min(46, (availW - 20) / cc.sliceCount - 6);
  let ix = MARGIN;
  let iy = ay + 6;
  cc.sliceOps.forEach((op, i) => {
    if (ix + iconW > page.w - MARGIN) {
      ix = MARGIN;
      iy += 74;
    }
    content += `<rect x="${ix}" y="${iy}" width="${iconW.toFixed(1)}" height="30" fill="#eef2f6" stroke="${INK}" stroke-width="0.8"/>`;
    content += `<text x="${(ix + iconW / 2).toFixed(1)}" y="${iy + 14}" ${FONT} font-size="10" text-anchor="middle" fill="${INK}">${i + 1}</text>`;
    const glyphs: string[] = [];
    if (op.reverse) glyphs.push('↻180°');
    if (op.mirror) glyphs.push('flip');
    if (op.shift) glyphs.push('→');
    content += `<text x="${(ix + iconW / 2).toFixed(1)}" y="${iy + 26}" ${FONT} font-size="8.5" text-anchor="middle" fill="${glyphs.length ? '#c22' : FAINT}">${glyphs.length ? escapeXml(glyphs.join(' ')) : 'as cut'}</text>`;
    ix += iconW + 6;
  });

  // legend of ops
  const cs = ctx.cutlist.crosscut!;
  let ty = iy + 58;
  const lines: string[] = [];
  if (cs.reversed.length) lines.push(`Rotate end-for-end: slices ${formatSliceList(cs.reversed)}`);
  if (cs.mirrored.length) lines.push(`Flip face-down: slices ${formatSliceList(cs.mirrored)}`);
  if (cs.shifted.length) lines.push(`Shift: ${cs.shifted.map((s) => `#${s.slice} by ${fmt(s.by)}`).join(', ')}`);
  if (!lines.length) lines.push('All slices glue up exactly as cut.');
  for (const l of lines) {
    content += `<text x="${MARGIN}" y="${ty}" ${FONT} font-size="11" fill="${INK}">• ${escapeXml(l)}</text>`;
    ty += 17;
  }

  // species letter legend (compact)
  ty += 10;
  let lx = MARGIN;
  for (const [id, letter] of letters) {
    const v = ctx.visual(id);
    content += `<rect x="${lx}" y="${ty - 10}" width="14" height="12" fill="${v.hex}" stroke="${INK}" stroke-width="0.6"/>`;
    content += `<text x="${lx + 18}" y="${ty}" ${FONT} font-size="10" fill="${INK}">${letter} = ${escapeXml(v.name)}</text>`;
    lx += 26 + v.name.length * 5.4 + 24;
  }
  return content;
}

/* ---------------- page 4: cut list & materials ---------------- */

function page4(ctx: Ctx): string {
  const fmt = f(ctx);
  const fdd = fd(ctx);
  const cl = ctx.cutlist;
  let y = MARGIN + 70;
  let content = '';

  const spCols = [
    { header: 'Species', width: 190 },
    { header: 'Strips', width: 50, align: 'end' as const },
    { header: 'Raw rip width', width: 125, align: 'end' as const },
    { header: 'Board feet*', width: 85, align: 'end' as const },
    { header: 'Est. cost', width: 70, align: 'end' as const },
    { header: 'Buy at least', width: 150 },
  ];
  const sp = table(
    MARGIN,
    y,
    spCols,
    cl.perSpecies.map((s) => [
      clip(ctx.info(s.species)?.name ?? s.species, spCols[0].width),
      `${s.stripCount}`,
      fmt(s.rawWidthNeeded),
      s.boardFeetRough.toFixed(2),
      s.costEstimate !== undefined ? `$${s.costEstimate.toFixed(0)}` : '—',
      clip(s.purchaseSuggestion.replace(/^≈ [\d.]+ bf — e\.g\. /, ''), spCols[5].width),
    ]),
    'Materials by species',
  );
  content += sp.svg;
  y += sp.height + 8;
  content += `<text x="${MARGIN}" y="${y}" ${FONT} font-size="9.5" fill="${FAINT}">* rough board feet incl. ${Math.round(cl.allowances.wasteFactor * 100)}% waste${cl.allowances.roughStock ? ' + 1/4″ milling allowances' : ''}. Total: ${cl.totals.boardFeetRough.toFixed(1)} bf${cl.totals.costEstimate !== undefined ? ` ≈ $${cl.totals.costEstimate.toFixed(0)}` : ''}.</text>`;
  y += 30;

  if (cl.crosscut) {
    const cc = cl.crosscut;
    const rows = [
      ['Slices', `${cc.sliceCount}`],
      ['Slice width', fmt(cc.sliceWidth)],
      ['Angle', `${cc.angleDeg}°`],
    ];
    if (cc.reversed.length) rows.push(['Rotate 180°', formatSliceList(cc.reversed)]);
    if (cc.mirrored.length) rows.push(['Flip face-down', formatSliceList(cc.mirrored)]);
    if (cc.shifted.length) rows.push(['Shifted', cc.shifted.map((s) => `#${s.slice} by ${fmt(s.by)}`).join(', ')]);
    const t = table(MARGIN, y, [{ header: 'Step', width: 150 }, { header: 'Value', width: 420 }], rows, 'Crosscut & arrangement');
    content += t.svg;
    y += t.height + 22;
  }

  const allow = table(
    MARGIN,
    y,
    [{ header: 'Allowance', width: 220 }, { header: 'Value', width: 350 }],
    [
      ['Kerf', fdd(cl.allowances.kerf)],
      ['Edge cleanup (width)', fdd(cl.allowances.widthTrim)],
      ['End trim (length)', fdd(cl.allowances.lengthTrim)],
      ['Planing loss per glue-up', fdd(cl.allowances.planingLoss)],
      ['Waste factor', `${Math.round(cl.allowances.wasteFactor * 100)}%`],
      ['Stock', cl.allowances.roughStock ? 'rough (adds 1/4″ each way)' : 'S4S'],
      ['Kerf convention', cl.allowances.kerfConvention],
    ],
    'Allowances (audit these!)',
  );
  content += allow.svg;
  y += allow.height + 22;

  if (cl.rounding.entries.length) {
    const t = table(
      MARGIN,
      y,
      [
        { header: 'Dimension', width: 220 },
        { header: 'Rounded (1/32″)', width: 150, align: 'end' },
        { header: 'Exact', width: 150, align: 'end' },
      ],
      cl.rounding.entries.slice(0, 12).map((e) => [
        e.label,
        formatCutDim(e.rounded, ctx.units),
        `${(e.exact / IN).toFixed(4)}″`,
      ]),
      `Rounding report${cl.rounding.driftWarning ? ' — ⚠ cumulative drift exceeds kerf/2' : ''}`,
    );
    content += t.svg;
  }

  return content;
}

/* ---------------- page 5: outline / shaping ---------------- */

function pageOutline(ctx: Ctx): string {
  const { result, page } = ctx;
  const fmt = f(ctx);
  const o = result.outline;
  const contentTop = MARGIN + 70;
  const availW = page.w - 2 * MARGIN - 60;
  const availH = page.h * 0.45;

  const wIn = result.grid.boardLength / IN;
  const hIn = result.grid.boardWidth / IN;
  let scaleN = 1;
  for (const n of [1, 1.5, 2, 3, 4, 6, 8, 12, 16]) {
    scaleN = n;
    if ((wIn * 96) / n <= availW && (hIn * 96) / n <= availH) break;
  }
  const s = 96 / scaleN / IN;
  const bw = result.grid.boardLength * s;
  const bh = result.grid.boardWidth * s;
  const bx = MARGIN + 30 + (availW - bw) / 2;
  const by = contentTop + 30;

  let content = `<text x="${MARGIN}" y="${contentTop}" ${FONT} font-size="12.5" font-weight="bold" fill="${INK}">Shaping — cut this profile from the glued blank</text>`;
  content += `<g transform="translate(${bx.toFixed(1)},${by.toFixed(1)})">`;
  // the blank, dashed, with the finished shape solid inside it
  content += `<rect x="0" y="0" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="#f7f4ee" stroke="${FAINT}" stroke-width="0.9" stroke-dasharray="6,4"/>`;
  content += `<path d="${outlineToPath(o, s)}" fill="none" stroke="${INK}" stroke-width="1.6"/>`;
  // centerlines to lay the shape out from
  content += `<line x1="${(bw / 2).toFixed(1)}" y1="-8" x2="${(bw / 2).toFixed(1)}" y2="${(bh + 8).toFixed(1)}" stroke="#c22" stroke-width="0.6" stroke-dasharray="9,3,2,3"/>`;
  content += `<line x1="-8" y1="${(bh / 2).toFixed(1)}" x2="${(bw + 8).toFixed(1)}" y2="${(bh / 2).toFixed(1)}" stroke="#c22" stroke-width="0.6" stroke-dasharray="9,3,2,3"/>`;
  content += `</g>`;
  content += dimH(bx, bx + bw, by - 14, fmt(result.grid.boardLength));
  content += dimV(bx + bw + 14, by, by + bh, fmt(result.grid.boardWidth));

  // shape-specific dimensions
  const rows: string[][] = [['Blank (glue up this rectangle)', `${fmt(result.grid.boardLength)} × ${fmt(result.grid.boardWidth)}`]];
  switch (o.kind) {
    case 'rect':
      rows.push(['Shape', 'Rounded rectangle']);
      rows.push(['Corner radius', fmt(o.cornerRadius)]);
      rows.push(['Corner centers', `${fmt(o.cornerRadius)} in from each edge`]);
      break;
    case 'ellipse':
      rows.push(['Shape', 'Ellipse']);
      rows.push(['Semi-axes', `${fmt(o.rx)} × ${fmt(o.ry)}`]);
      rows.push(['Center', `${fmt(o.rx)}, ${fmt(o.ry)} from the blank corner`]);
      break;
    case 'paddle':
      rows.push(['Shape', 'Paddle / handled board']);
      rows.push(['Body', `${fmt(o.bodyW)} × ${fmt(o.bodyH)}`]);
      rows.push(['Handle', `${fmt(o.handleL)} long × ${fmt(o.handleW)} wide`]);
      rows.push(['Handle centerline', `${fmt(Math.round(o.bodyH / 2))} from either long edge`]);
      rows.push(['Body corner radius', fmt(o.r)]);
      break;
    case 'polygon':
      rows.push(['Shape', `Custom polygon, ${o.points.length} points`]);
      break;
  }
  const finishedArea = ringArea(outlineToRing(o)) / (IN * IN);
  const blankArea = (result.grid.boardLength / IN) * (result.grid.boardWidth / IN);
  rows.push(['Finished surface', `${finishedArea.toFixed(1)} in² (${((finishedArea / blankArea) * 100).toFixed(0)}% of the blank)`]);

  const t = table(
    MARGIN,
    by + bh + 54,
    [{ header: 'Dimension', width: 250 }, { header: 'Value', width: 320 }],
    rows,
    'Layout',
  );
  content += t.svg;

  const noteY = by + bh + 54 + t.height + 24;
  content += `<text x="${MARGIN}" y="${noteY}" ${FONT} font-size="10.5" fill="${FAINT}">Glue up the full rectangle first — the pattern math assumes it. Lay out the profile from the centerlines,</text>`;
  content += `<text x="${MARGIN}" y="${noteY + 15}" ${FONT} font-size="10.5" fill="${FAINT}">cut just outside the line at the bandsaw, then flush-trim to a template or sand to the line.</text>`;
  return content;
}

/* ---------------- assembly ---------------- */

export function renderBlueprint(
  board: BoardSpec,
  result: PipelineResult,
  cutlist: CutList,
  lints: Lint[],
  visual: SpeciesVisualLookup,
  info: SpeciesInfoLookup,
  units: UnitMode,
  size: PageSize = 'letter',
): string[] {
  const ctx: Ctx = { board, result, cutlist, lints, visual, info, units, page: PAGES[size] };
  const pages: { title: string; content: string }[] = [
    { title: 'Finished board — top view', content: page1(ctx) },
    { title: 'Glue-up #1 — rip & glue', content: page2(ctx) },
  ];
  if (result.crosscut) pages.push({ title: 'Crosscut & arrangement', content: page3(ctx) });
  if (!isPlainRect(result.outline)) pages.push({ title: 'Shaping the outline', content: pageOutline(ctx) });
  pages.push({ title: 'Cut list & materials', content: page4(ctx) });
  return pages.map((p, i) => pageSvg(ctx, p.title, i + 1, pages.length, p.content));
}
