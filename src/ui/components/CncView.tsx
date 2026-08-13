import { useMemo } from 'react';
import { IN, formatDim } from '../../engine/units';
import type { PipelineResult } from '../../engine/construction/types';
import { outlineToPath } from '../../engine/geometry/outline';
import { generateToolpaths, estimateMinutes, type Move, type Operation } from '../../engine/cnc/toolpath';
import { defaultCncOptions } from '../../engine/cnc/types';
import { useStore } from '../../store/store';
import { useContainerWidth } from '../hooks';

const OP_COLOR: Record<string, string> = {
  profile: '#c0392b',
  groove: '#2471a3',
  pocket: '#1e8449',
  engrave: '#8e44ad',
};

/**
 * Toolpath visualizer: draws the moves we will actually post, over the board.
 * Rapids are dashed; cutting moves are shaded by depth so plunges are obvious.
 */
export function CncView({ result }: { result: PipelineResult }) {
  const board = useStore((s) => s.board);
  const units = useStore((s) => s.units);
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const cnc = board.cnc ?? defaultCncOptions(result.finished.thickness);

  const paths = useMemo(() => generateToolpaths(result.outline, cnc), [result.outline, cnc]);

  const lenIn = result.grid.boardLength / IN;
  const widIn = result.grid.boardWidth / IN;
  const pxPerIn = Math.max(6, Math.min(46, (width - 80) / Math.max(1, lenIn), 430 / Math.max(1, widIn)));
  const s = pxPerIn / IN;
  const W = result.grid.boardLength * s;
  const H = result.grid.boardWidth * s;

  return (
    <div className="canvas-stage" ref={ref}>
      {paths.errors.length > 0 && (
        <div className="cnc-errors">
          {paths.errors.map((e, i) => (
            <div key={i}>✖ {e}</div>
          ))}
        </div>
      )}
      <svg width={W + 40} height={H + 40} className="cnc-svg">
        <g transform="translate(20,20)">
          <path d={outlineToPath(result.outline, s)} fill="#f4efe6" stroke="#8d7f68" strokeWidth={1} />
          {paths.operations.map((op) => (
            <OperationPaths key={op.kind} op={op} s={s} />
          ))}
        </g>
      </svg>

      <div className="cnc-legend">
        {paths.operations.length === 0 && <span className="hint">No operations enabled — turn them on in the CNC panel.</span>}
        {paths.operations.map((op) => (
          <span key={op.kind} className="cnc-legend-item">
            <i style={{ background: OP_COLOR[op.kind] }} />
            {op.name} · {op.tool.name} · {formatDim(op.maxDepth, units)} deep · ≈{Math.max(1, Math.round(estimateMinutes(op)))} min
          </span>
        ))}
        <span className="hint">Dashed = rapid moves. Always air-cut a new program before putting wood on the table.</span>
      </div>

      {paths.warnings.length > 0 && (
        <div className="cnc-warnings">
          {[...new Set(paths.warnings)].map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function OperationPaths({ op, s }: { op: Operation; s: number }) {
  const color = OP_COLOR[op.kind] ?? '#555';
  const { cuts, rapids } = useMemo(() => splitMoves(op.moves), [op.moves]);
  return (
    <g>
      {rapids.map((seg, i) => (
        <path
          key={`r${i}`}
          d={toPath(seg, s)}
          fill="none"
          stroke="#9aa7b1"
          strokeWidth={0.6}
          strokeDasharray="4,4"
        />
      ))}
      {cuts.map((seg, i) => (
        <path
          key={`c${i}`}
          d={toPath(seg.points, s)}
          fill="none"
          stroke={color}
          strokeWidth={1.4}
          strokeOpacity={seg.depthFraction}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

interface CutSegment {
  points: Move[];
  depthFraction: number;
}

/** Split moves into contiguous rapid and cutting runs, grouped by depth. */
function splitMoves(moves: Move[]): { cuts: CutSegment[]; rapids: Move[][] } {
  const cuts: CutSegment[] = [];
  const rapids: Move[][] = [];
  const maxDepth = Math.max(1, ...moves.map((m) => Math.abs(m.z)));

  let run: Move[] = [];
  let runIsRapid = moves[0]?.kind === 'rapid';
  const flush = () => {
    if (run.length > 1) {
      if (runIsRapid) rapids.push(run);
      else {
        const deepest = Math.max(...run.map((m) => Math.abs(m.z)));
        cuts.push({ points: run, depthFraction: 0.35 + 0.65 * (deepest / maxDepth) });
      }
    }
    run = [];
  };

  for (const m of moves) {
    const isRapid = m.kind === 'rapid';
    if (isRapid !== runIsRapid) {
      // carry the boundary point so the runs visually connect
      const last = run[run.length - 1];
      flush();
      runIsRapid = isRapid;
      if (last) run.push(last);
    }
    run.push(m);
  }
  flush();
  return { cuts, rapids };
}

function toPath(moves: Move[], s: number): string {
  return `M${moves.map((m) => `${(m.to.x * s).toFixed(2)},${(m.to.y * s).toFixed(2)}`).join('L')}`;
}
