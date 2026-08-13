import { useMemo, useRef, useState } from 'react';
import { IN, formatCutDim } from '../../engine/units';
import type { BoardSpec, PipelineResult } from '../../engine/construction/types';
import {
  PATCH_LABEL,
  REGION_COUNT,
  fillEmpty,
  makePatch,
  mirrorGridH,
  mirrorGridV,
  patchRegions,
  rotateGrid,
  resizeGrid,
  type Patch,
  type PatchGrid,
  type PatchKind,
} from '../../engine/patterns/patches';
import { SPECIES_BY_ID } from '../../data/species';
import { useStore } from '../../store/store';
import { useContainerWidth, useSpeciesVisual } from '../hooks';

type PatchConstruction = Extract<BoardSpec['construction'], { kind: 'patch' }>;

const PALETTE: PatchKind[] = ['full', 'hst', 'qst', 'halfV', 'halfH', 'quarters', 'stripes3', 'chevron'];

/**
 * Interactive pattern designer.
 *
 * Placement is free in feel and constrained in fact: you drag a shape wherever
 * you like and it lands on a cell. That constraint is the whole point — a patch
 * that is always one of eight known shapes on a known lattice has a cut list
 * that is arithmetic rather than guesswork, which is how quilt design software
 * has always done it.
 */
export function PatchStudio({ result }: { result: PipelineResult }) {
  const board = useStore((s) => s.board);
  const updateBoard = useStore((s) => s.updateBoard);
  const units = useStore((s) => s.units);
  const visual = useSpeciesVisual();
  const [ref, width] = useContainerWidth<HTMLDivElement>();

  const grid = (board.construction as PatchConstruction).grid;
  const [tool, setTool] = useState<PatchKind>('hst');
  const [speciesA, setSpeciesA] = useState('black-walnut');
  const [speciesB, setSpeciesB] = useState('hard-maple');
  const [painting, setPainting] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const setGrid = (next: PatchGrid) =>
    updateBoard((d) => {
      (d.construction as PatchConstruction).grid = next;
      d.targetLength = next.cols * next.cell;
      d.targetWidth = next.rows * next.cell;
    });

  const paletteSpecies = useMemo(() => [speciesA, speciesB, speciesA, speciesB], [speciesA, speciesB]);

  const applyAt = (index: number, mode: 'paint' | 'rotate' | 'flip' | 'erase') => {
    updateBoard((d) => {
      const g = (d.construction as PatchConstruction).grid;
      const cur = g.patches[index];
      if (mode === 'erase') {
        g.patches[index] = null;
        return;
      }
      if (mode === 'rotate' && cur) {
        cur.rot = ((cur.rot + 1) % 4) as 0 | 1 | 2 | 3;
        return;
      }
      if (mode === 'flip' && cur) {
        cur.flip = !cur.flip;
        return;
      }
      g.patches[index] = makePatch(tool, paletteSpecies.slice(0, REGION_COUNT[tool]));
    });
  };

  const cellPx = Math.max(
    18,
    Math.min(64, (Math.max(320, width) - 80) / Math.max(1, grid.cols), 420 / Math.max(1, grid.rows)),
  );
  const W = grid.cols * cellPx;
  const H = grid.rows * cellPx;

  const cellFromEvent = (e: React.PointerEvent): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left) / cellPx);
    const j = Math.floor((e.clientY - rect.top) / cellPx);
    if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return null;
    return j * grid.cols + i;
  };

  return (
    <div className="canvas-stage" ref={ref}>
      <div className="studio-toolbar">
        <div className="studio-palette">
          {PALETTE.map((k) => (
            <button
              key={k}
              className={`palette-chip ${tool === k ? 'palette-on' : ''}`}
              title={`${PATCH_LABEL[k]} — drag onto the grid`}
              draggable
              onDragStart={(e) => {
                setTool(k);
                e.dataTransfer.setData('text/betterboards-patch', k);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => setTool(k)}
            >
              <svg viewBox="0 0 1 1" width="26" height="26">
                {patchRegions(makePatch(k, paletteSpecies.slice(0, REGION_COUNT[k]))).map((region, i) => (
                  <polygon
                    key={i}
                    points={region.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill={SPECIES_BY_ID.get(paletteSpecies[i % paletteSpecies.length])?.displayHex ?? '#ccc'}
                    stroke="#3a2c1a"
                    strokeWidth={0.02}
                  />
                ))}
              </svg>
            </button>
          ))}
        </div>

        <div className="studio-species">
          <label>
            <span>A</span>
            <select value={speciesA} onChange={(e) => setSpeciesA(e.target.value)}>
              {[...SPECIES_BY_ID.values()].map((s) => (
                <option key={s.id} value={s.id}>
                  {s.commonName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>B</span>
            <select value={speciesB} onChange={(e) => setSpeciesB(e.target.value)}>
              {[...SPECIES_BY_ID.values()].map((s) => (
                <option key={s.id} value={s.id}>
                  {s.commonName}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="studio-actions">
        <button onClick={() => setGrid(mirrorGridH(grid))} title="Mirror the whole design left ↔ right">⇋ Mirror H</button>
        <button onClick={() => setGrid(mirrorGridV(grid))} title="Mirror the whole design top ↔ bottom">⇵ Mirror V</button>
        <button onClick={() => setGrid(rotateGrid(grid))} title="Rotate the whole design 90°">↻ Rotate</button>
        <button onClick={() => setGrid(fillEmpty(grid, speciesA))} title="Fill every empty cell with species A">Fill empty</button>
        <span className="studio-size">
          <label>
            cols
            <input
              type="number"
              min={1}
              max={24}
              value={grid.cols}
              onChange={(e) => setGrid(resizeGrid(grid, Math.max(1, Math.min(24, Number(e.target.value))), grid.rows))}
            />
          </label>
          <label>
            rows
            <input
              type="number"
              min={1}
              max={24}
              value={grid.rows}
              onChange={(e) => setGrid(resizeGrid(grid, grid.cols, Math.max(1, Math.min(24, Number(e.target.value)))))}
            />
          </label>
          <label>
            cell
            <input
              type="number"
              min={0.5}
              step={0.25}
              value={Number((grid.cell / IN).toFixed(2))}
              onChange={(e) => {
                const v = Math.max(0.5, Number(e.target.value));
                setGrid({ ...grid, cell: Math.round(v * IN) });
              }}
            />
            in
          </label>
        </span>
      </div>

      <svg
        ref={svgRef}
        className="studio-grid"
        width={W}
        height={H}
        onPointerDown={(e) => {
          const idx = cellFromEvent(e);
          if (idx === null) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setPainting(true);
          if (e.shiftKey) applyAt(idx, 'erase');
          else if (e.altKey) applyAt(idx, 'flip');
          else if (e.ctrlKey || e.metaKey) applyAt(idx, 'rotate');
          else applyAt(idx, 'paint');
        }}
        onPointerMove={(e) => {
          const idx = cellFromEvent(e);
          setHover(idx);
          if (painting && idx !== null && !e.ctrlKey && !e.metaKey && !e.altKey) {
            applyAt(idx, e.shiftKey ? 'erase' : 'paint');
          }
        }}
        onPointerUp={() => setPainting(false)}
        onPointerLeave={() => {
          setPainting(false);
          setHover(null);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('text/betterboards-patch')) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const svg = svgRef.current;
          if (!svg) return;
          const rect = svg.getBoundingClientRect();
          const i = Math.floor((e.clientX - rect.left) / cellPx);
          const j = Math.floor((e.clientY - rect.top) / cellPx);
          if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return;
          const kind = (e.dataTransfer.getData('text/betterboards-patch') || tool) as PatchKind;
          updateBoard((d) => {
            const g = (d.construction as PatchConstruction).grid;
            g.patches[j * g.cols + i] = makePatch(kind, paletteSpecies.slice(0, REGION_COUNT[kind]));
          });
        }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#f6f2ea" />
        {grid.patches.map((patch, idx) => {
          const i = idx % grid.cols;
          const j = Math.floor(idx / grid.cols);
          const x = i * cellPx;
          const y = j * cellPx;
          return (
            <g key={idx}>
              {patch ? (
                patchRegions(patch).map((region, ri) => (
                  <polygon
                    key={ri}
                    points={region.map(([ux, uy]) => `${x + ux * cellPx},${y + uy * cellPx}`).join(' ')}
                    fill={visual(patch.species[ri] ?? patch.species[0]).hex}
                    stroke="#3a2c1a"
                    strokeOpacity={0.45}
                    strokeWidth={0.7}
                  />
                ))
              ) : (
                <rect
                  x={x}
                  y={y}
                  width={cellPx}
                  height={cellPx}
                  fill="url(#studio-empty)"
                  stroke="#c9bda6"
                  strokeWidth={0.6}
                />
              )}
              {hover === idx && (
                <rect x={x} y={y} width={cellPx} height={cellPx} fill="none" stroke="#8a5a2b" strokeWidth={2} />
              )}
            </g>
          );
        })}
        <defs>
          <pattern id="studio-empty" width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#efe9dd" />
            <path d="M0,8 L8,0" stroke="#ddd2bd" strokeWidth="1" />
          </pattern>
        </defs>
        <g>
          {Array.from({ length: grid.cols + 1 }, (_, i) => (
            <line key={`v${i}`} x1={i * cellPx} y1={0} x2={i * cellPx} y2={H} stroke="#b8ab92" strokeWidth={0.4} />
          ))}
          {Array.from({ length: grid.rows + 1 }, (_, j) => (
            <line key={`h${j}`} x1={0} y1={j * cellPx} x2={W} y2={j * cellPx} stroke="#b8ab92" strokeWidth={0.4} />
          ))}
        </g>
      </svg>

      <p className="hint studio-help">
        Drag a shape from the palette, or click and drag across the grid to paint. <b>Ctrl/⌘-click</b> rotates a patch,
        <b> Alt-click</b> mirrors it, <b>Shift-drag</b> erases. Every patch snaps to a {formatCutDim(grid.cell, units)}{' '}
        cell — that is what keeps the cut list exact.
      </p>
    </div>
  );
}
