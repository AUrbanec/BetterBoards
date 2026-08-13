import { useMemo } from 'react';
import { IN, formatCutDim } from '../../engine/units';
import { resolveTransform } from '../../engine/construction/pipeline';
import type { BoardSpec, PerSliceOp, PipelineResult } from '../../engine/construction/types';
import { renderBoardSvg } from '../../exports/boardSvg';
import { useStore } from '../../store/store';
import { useContainerWidth, useSpeciesVisual } from '../hooks';

type EndConstruction = Extract<BoardSpec['construction'], { kind: 'endGrain' }>;

export function Canvas({ result }: { result: PipelineResult }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const showLabels = useStore((s) => s.showLabels);
  const toggleLabels = useStore((s) => s.toggleLabels);
  const units = useStore((s) => s.units);
  const board = useStore((s) => s.board);
  const isEnd = board.construction.kind === 'endGrain';

  return (
    <div className="canvas-wrap">
      <div className="canvas-tabs">
        <div className="seg">
          <button className={view === 'top' ? 'seg-on' : ''} onClick={() => setView('top')}>Top</button>
          <button className={view === 'end' ? 'seg-on' : ''} onClick={() => setView('end')}>Glue-up #1</button>
          {isEnd && <button className={view === 'slab' ? 'seg-on' : ''} onClick={() => setView('slab')}>Crosscut</button>}
        </div>
        <label className="chk">
          <input type="checkbox" checked={showLabels} onChange={toggleLabels} /> species letters
        </label>
      </div>
      {view === 'top' && <TopView result={result} showLabels={showLabels} />}
      {view === 'end' && <EndView result={result} />}
      {view === 'slab' && isEnd && <SlabView result={result} />}
      <div className="canvas-dims">
        {result.ok
          ? `${formatCutDim(result.finished.length, units)} × ${formatCutDim(result.finished.width, units)} × ${formatCutDim(result.finished.thickness, units)}`
          : 'Fix the errors below to see the board.'}
      </div>
    </div>
  );
}

function TopView({ result, showLabels }: { result: PipelineResult; showLabels: boolean }) {
  const visual = useSpeciesVisual();
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const board = useStore((s) => s.board);

  const svg = useMemo(() => {
    if (!result.ok || result.grid.rows.length === 0) return '';
    const lenIn = result.grid.boardLength / IN;
    const widIn = result.grid.boardWidth / IN;
    const pxPerIn = Math.max(6, Math.min(52, (width - 60) / lenIn, 460 / widIn));
    return renderBoardSvg(result.grid, visual, {
      pxPerIn,
      showLabels,
      idPrefix: 'live',
      outline: result.outline,
      showBlank: true,
    });
  }, [result, visual, width, showLabels]);

  return (
    <div className="canvas-stage" ref={ref}>
      {result.ok ? (
        <>
          <div className="board-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          {board.construction.kind === 'endGrain' && result.crosscut && <SliceArranger result={result} />}
        </>
      ) : (
        <div className="canvas-error">✖ {result.issues.find((i) => i.level === 'error')?.message}</div>
      )}
    </div>
  );
}

/** Click a slice to cycle its op: as-cut → rotate 180° → (flip on angled) → back. */
function SliceArranger({ result }: { result: PipelineResult }) {
  const board = useStore((s) => s.board);
  const updateBoard = useStore((s) => s.updateBoard);
  const construction = board.construction as EndConstruction;
  const angled = construction.crosscut.angleDeg !== 90;
  const ops = useMemo(
    () => resolveTransform(construction.transform, result.crosscut!.sliceCount, angled),
    [construction.transform, result, angled],
  );

  const cycle = (i: number) => {
    const next: PerSliceOp[] = ops.map((o) => ({ ...o }));
    const cur = next[i];
    const state = cur.reverse && cur.mirror ? 3 : cur.mirror ? 2 : cur.reverse ? 1 : 0;
    const order = angled ? [0, 1, 2, 3] : [0, 1];
    const nextState = order[(order.indexOf(state) + 1) % order.length];
    next[i] = {
      ...(nextState === 1 || nextState === 3 ? { reverse: true } : {}),
      ...(nextState === 2 || nextState === 3 ? { mirror: true } : {}),
      ...(cur.shift ? { shift: cur.shift } : {}),
    };
    updateBoard((d) => {
      (d.construction as EndConstruction).transform = { kind: 'sequence', ops: next };
    });
  };

  return (
    <div className="arranger">
      <span className="hint">slices (click to flip/rotate):</span>
      {ops.map((op, i) => {
        const tag = [op.reverse ? '↻' : '', op.mirror ? '⇋' : '', op.shift ? '→' : ''].join('') || '·';
        return (
          <button key={i} className={`slice-chip ${tag !== '·' ? 'slice-chip-on' : ''}`} title={`Slice ${i + 1}: ${op.reverse ? 'rotate 180° ' : ''}${op.mirror ? 'flip ' : ''}${op.shift ? 'shifted' : ''}${!op.reverse && !op.mirror && !op.shift ? 'as cut' : ''}`} onClick={() => cycle(i)}>
            {i + 1}
            <span>{tag}</span>
          </button>
        );
      })}
    </div>
  );
}

function EndView({ result }: { result: PipelineResult }) {
  const visual = useSpeciesVisual();
  const units = useStore((s) => s.units);
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const g1 = result.glueUp1;
  if (!result.ok) return <div className="canvas-stage" />;
  const slabIn = g1.slabWidth / IN;
  const pxPerIn = Math.max(8, Math.min(56, (width - 80) / slabIn));
  const h = (g1.slabThickness / IN) * pxPerIn;
  let x = 0;
  const rects = g1.strips.map((s, i) => {
    const w = (s.width / IN) * pxPerIn;
    const v = visual(s.species);
    const r = (
      <g key={i}>
        <rect x={x} y={0} width={w} height={h} fill={v.hex} stroke="#241809" strokeWidth={0.8} />
        {w > 14 && (
          <text x={x + w / 2} y={h / 2 + 4} textAnchor="middle" fontSize={11} fill="#1a120a" opacity={0.7}>
            {v.letter}
          </text>
        )}
      </g>
    );
    x += w;
    return r;
  });
  return (
    <div className="canvas-stage" ref={ref}>
      <div className="end-view">
        <svg width={x + 2} height={h + 40}>
          <g transform="translate(1,4)">{rects}</g>
          <text x={x / 2} y={h + 26} textAnchor="middle" fontSize={12} fill="#5a6b7c">
            slab cross-section — {formatCutDim(g1.slabWidth, units)} wide × {formatCutDim(g1.slabThickness, units)} thick, strips {formatCutDim(g1.slabLength, units)} long
          </text>
        </svg>
      </div>
    </div>
  );
}

function SlabView({ result }: { result: PipelineResult }) {
  const visual = useSpeciesVisual();
  const units = useStore((s) => s.units);
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const g1 = result.glueUp1;
  const cc = result.crosscut;
  if (!result.ok || !cc) return <div className="canvas-stage" />;
  const pxPerIn = Math.max(4, Math.min(30, (width - 70) / (g1.slabLength / IN)));
  const bw = (g1.slabLength / IN) * pxPerIn;
  const bh = (g1.slabWidth / IN) * pxPerIn;
  const sin = Math.sin((cc.angleDeg * Math.PI) / 180);
  const cot = cc.angleDeg === 90 ? 0 : Math.cos((cc.angleDeg * Math.PI) / 180) / sin;
  const advPx = (cc.advancePerSlice / IN) * pxPerIn;
  const wastePx = (cc.endWaste / IN) * pxPerIn;

  let y = 0;
  const bands = g1.strips.map((s, i) => {
    const h = (s.width / IN) * pxPerIn;
    const v = visual(s.species);
    const r = <rect key={i} x={0} y={y} width={bw} height={h} fill={v.hex} stroke="#241809" strokeWidth={0.4} />;
    y += h;
    return r;
  });

  const cuts = [];
  for (let i = 0; i <= cc.sliceCount; i++) {
    const xTop = wastePx + i * advPx;
    const xBot = xTop - cot * bh;
    if (Math.max(xTop, xBot) > bw + 2) break;
    cuts.push(
      <g key={i}>
        <line x1={xTop} y1={0} x2={xBot} y2={bh} stroke="#c22" strokeWidth={1.2} strokeDasharray="6,3" />
        {i < cc.sliceCount && (
          <text x={xTop + advPx / 2} y={-5} textAnchor="middle" fontSize={10} fill="#c22">
            {i + 1}
          </text>
        )}
      </g>,
    );
  }

  return (
    <div className="canvas-stage" ref={ref}>
      <div className="end-view">
        <svg width={bw + 2} height={bh + 58}>
          <g transform="translate(1,20)">
            {bands}
            {cuts}
          </g>
          <text x={bw / 2} y={bh + 30} textAnchor="middle" fontSize={12} fill="#5a6b7c">
            {cc.sliceCount} slices at {cc.angleDeg}°, each {formatCutDim(cc.sliceWidth, units)} wide — slab {formatCutDim(g1.slabLength, units)}
          </text>
        </svg>
      </div>
    </div>
  );
}
