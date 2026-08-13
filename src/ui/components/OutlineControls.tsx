import { inch } from '../../engine/units';
import type { OutlineSpec } from '../../engine/geometry/outline';
import { useStore } from '../../store/store';
import { DimInput } from './DimInput';

type Kind = OutlineSpec['kind'];

const LABELS: Record<Kind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse / circle',
  paddle: 'Paddle (handle)',
  polygon: 'Custom polygon',
};

/**
 * The outline is inscribed in the blank the pattern produces, so these controls
 * only shape it — overall size still comes from the board dimensions above.
 */
export function OutlineControls() {
  const board = useStore((s) => s.board);
  const updateBoard = useStore((s) => s.updateBoard);
  const spec = board.outline ?? { kind: 'rect' as const, cornerRadius: 0 };

  const setKind = (kind: Kind) => {
    updateBoard((d) => {
      switch (kind) {
        case 'rect':
          d.outline = { kind: 'rect', cornerRadius: 0 };
          break;
        case 'ellipse':
          d.outline = { kind: 'ellipse' };
          break;
        case 'paddle':
          d.outline = { kind: 'paddle', handleL: inch(4), handleW: inch(2.5), filletR: inch(1) };
          break;
        case 'polygon':
          // seed from the current blank so the editor starts somewhere sane
          d.outline = {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: d.targetLength, y: 0 },
              { x: d.targetLength, y: d.targetWidth || d.targetLength / 2 },
              { x: 0, y: d.targetWidth || d.targetLength / 2 },
            ],
          };
          break;
      }
    });
  };

  return (
    <>
      <label className="row">
        <span>Outline</span>
        <select value={spec.kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {(Object.keys(LABELS) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {LABELS[k]}
            </option>
          ))}
        </select>
      </label>

      {spec.kind === 'rect' && (
        <label className="row indent">
          <span>Corner radius</span>
          <DimInput
            value={spec.cornerRadius}
            min={0}
            onCommit={(nm) =>
              updateBoard((d) => {
                d.outline = { kind: 'rect', cornerRadius: nm };
              })
            }
          />
        </label>
      )}

      {spec.kind === 'paddle' && (
        <>
          <label className="row indent">
            <span>Handle length</span>
            <DimInput
              value={spec.handleL}
              onCommit={(nm) =>
                updateBoard((d) => {
                  if (d.outline?.kind === 'paddle') d.outline.handleL = nm;
                })
              }
            />
          </label>
          <label className="row indent">
            <span>Handle width</span>
            <DimInput
              value={spec.handleW}
              onCommit={(nm) =>
                updateBoard((d) => {
                  if (d.outline?.kind === 'paddle') d.outline.handleW = nm;
                })
              }
            />
          </label>
          <label className="row indent">
            <span>Body radius</span>
            <DimInput
              value={spec.filletR}
              min={0}
              onCommit={(nm) =>
                updateBoard((d) => {
                  if (d.outline?.kind === 'paddle') d.outline.filletR = nm;
                })
              }
            />
          </label>
        </>
      )}

      {spec.kind === 'ellipse' && (
        <p className="hint indent-p">
          Axes follow the board size — a square blank gives a circle.
        </p>
      )}

      {spec.kind === 'polygon' && <PolygonEditor points={spec.points} />}
    </>
  );
}

function PolygonEditor({ points }: { points: { x: number; y: number }[] }) {
  const updateBoard = useStore((s) => s.updateBoard);

  const setPoint = (i: number, axis: 'x' | 'y', nm: number) =>
    updateBoard((d) => {
      if (d.outline?.kind === 'polygon') d.outline.points[i][axis] = nm;
    });

  return (
    <div className="poly-editor">
      <p className="hint">
        Points measured from the blank's top-left corner. Keep them inside the blank — the pattern is only glued that big.
      </p>
      {points.map((p, i) => (
        <div className="row indent" key={i}>
          <span>#{i + 1}</span>
          <DimInput value={p.x} min={0} width={58} onCommit={(nm) => setPoint(i, 'x', nm)} />
          <DimInput value={p.y} min={0} width={58} onCommit={(nm) => setPoint(i, 'y', nm)} />
          <button
            title="Remove point"
            disabled={points.length <= 3}
            onClick={() =>
              updateBoard((d) => {
                if (d.outline?.kind === 'polygon') d.outline.points.splice(i, 1);
              })
            }
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="add-group"
        onClick={() =>
          updateBoard((d) => {
            if (d.outline?.kind !== 'polygon') return;
            const pts = d.outline.points;
            const a = pts[pts.length - 1];
            const b = pts[0];
            pts.push({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
          })
        }
      >
        + Add point
      </button>
    </div>
  );
}
