import { inch, type Nm } from '../../engine/units';
import type { BoardSpec, LayerGroup, SliceTransform } from '../../engine/construction/types';
import type { OutlineSpec } from '../../engine/geometry/outline';
import { emptyGrid, makePatch } from '../../engine/patterns/patches';
import { useStore } from '../../store/store';
import { useSpeciesVisual } from '../hooks';
import { DimInput } from './DimInput';
import { BlockControls } from './BlockControls';
import { CurveControls } from './CurveControls';
import { OutlineControls } from './OutlineControls';

type EndConstruction = Extract<BoardSpec['construction'], { kind: 'endGrain' }>;
type EdgeConstruction = Extract<BoardSpec['construction'], { kind: 'edgeGrain' }>;

export function LayerPanel() {
  const board = useStore((s) => s.board);
  const updateBoard = useStore((s) => s.updateBoard);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setSpeciesTab = useStore((s) => s.setSpeciesTab);
  const visual = useSpeciesVisual();

  const c = board.construction;
  const isEnd = c.kind === 'endGrain';
  const isBlocks = c.kind === 'blocks';
  const isPatch = c.kind === 'patch';
  const angled = isEnd && (c as EndConstruction).crosscut.angleDeg !== 90;
  const diagonal = c.kind === 'edgeGrain' && ((c as EdgeConstruction).diagonalAngleDeg ?? 0) !== 0;
  // block fields and angled/diagonal patterns take an explicit finished width;
  // straight strip stacks derive it from the stack
  const explicitWidth = angled || diagonal || isBlocks || c.kind === 'curve';

  const setKind = (kind: 'edgeGrain' | 'endGrain' | 'blocks' | 'curve' | 'patch') => {
    updateBoard((d) => {
      if (kind === d.construction.kind) return;
      if (kind === 'edgeGrain') {
        d.construction = { kind: 'edgeGrain', layers: d.construction.layers };
      } else if (kind === 'curve') {
        const strips = d.construction.layers[0]?.strips ?? [];
        d.construction = {
          kind: 'curve',
          layers: d.construction.layers,
          pattern: {
            kind: 'parabolic',
            columns: 16,
            speciesLow: strips[0]?.species ?? 'black-walnut',
            speciesHigh: strips[1]?.species ?? 'hard-maple',
            accentWidth: 0,
            rise: 0.62,
            shape: 'arch',
            inverted: false,
          },
        };
        if (d.targetWidth <= 0) d.targetWidth = inch(12);
      } else if (kind === 'patch') {
        const strips = d.construction.layers[0]?.strips ?? [];
        const cell = inch(2.25);
        const grid = emptyGrid(6, 6, cell);
        const a = strips[0]?.species ?? 'hard-maple';
        for (let i = 0; i < grid.patches.length; i++) grid.patches[i] = makePatch('full', [a]);
        d.construction = { kind: 'patch', layers: d.construction.layers, grid };
        d.targetLength = grid.cols * cell;
        d.targetWidth = grid.rows * cell;
      } else if (kind === 'blocks') {
        const strips = d.construction.layers[0]?.strips ?? [];
        d.construction = {
          kind: 'blocks',
          layers: d.construction.layers,
          pattern: {
            kind: 'pinwheel',
            unit: inch(4.5),
            speciesA: strips[0]?.species ?? 'black-walnut',
            speciesB: strips[1]?.species ?? 'hard-maple',
          },
        };
        // block fields need an explicit width — they are not derived from a stack
        if (d.targetWidth <= 0) d.targetWidth = inch(12);
      } else {
        d.construction = {
          kind: 'endGrain',
          layers: d.construction.layers,
          crosscut: { angleDeg: 90 },
          transform: { kind: 'flipAlternate' },
        };
        if (d.stockThickness < inch(1)) d.stockThickness = inch(1.625);
      }
    });
  };

  const setTransform = (t: SliceTransform) =>
    updateBoard((d) => {
      (d.construction as EndConstruction).transform = t;
    });

  const transformKind = isEnd ? (c as EndConstruction).transform.kind : 'none';

  return (
    <div className="panel layer-panel">
      <h3>Construction</h3>
      <div className="row seg">
        <button className={c.kind === 'edgeGrain' ? 'seg-on' : ''} onClick={() => setKind('edgeGrain')}>Edge grain</button>
        <button className={c.kind === 'endGrain' ? 'seg-on' : ''} onClick={() => setKind('endGrain')}>End grain</button>
        <button className={c.kind === 'blocks' ? 'seg-on' : ''} onClick={() => setKind('blocks')}>Blocks</button>
      </div>
      <div className="row seg">
        <button className={c.kind === 'curve' ? 'seg-on' : ''} onClick={() => setKind('curve')}>Curves</button>
        <button className={c.kind === 'patch' ? 'seg-on' : ''} onClick={() => setKind('patch')}>Patch studio</button>
      </div>

      {c.kind === 'blocks' && <BlockControls />}
      {c.kind === 'curve' && <CurveControls />}
      {c.kind === 'patch' && (
        <p className="hint">
          Design on the grid in the centre panel. Board size follows the lattice, so the cut list stays exact.
        </p>
      )}

      {c.kind === 'edgeGrain' && (
        <label className="row">
          <span>Stripe angle</span>
          <select
            value={(c as EdgeConstruction).diagonalAngleDeg ?? 0}
            onChange={(e) =>
              updateBoard((d) => {
                (d.construction as EdgeConstruction).diagonalAngleDeg = Number(e.target.value);
              })
            }
          >
            <option value={0}>Straight (0°)</option>
            <option value={30}>Diagonal 30°</option>
            <option value={45}>Diagonal 45°</option>
            <option value={60}>Diagonal 60°</option>
          </select>
        </label>
      )}

      {isEnd && (
        <>
          <label className="row">
            <span>Crosscut</span>
            <select
              value={(c as EndConstruction).crosscut.angleDeg}
              onChange={(e) =>
                updateBoard((d) => {
                  const cc = (d.construction as EndConstruction).crosscut;
                  cc.angleDeg = Number(e.target.value);
                  if (cc.angleDeg !== 90 && !cc.sliceWidth) cc.sliceWidth = inch(1.75);
                })
              }
            >
              <option value={90}>Square (90°)</option>
              <option value={60}>Angled 60°</option>
              <option value={45}>Angled 45° (chevron)</option>
              <option value={30}>Angled 30°</option>
            </select>
          </label>
          <label className="row">
            <span>Arrangement</span>
            <select
              value={transformKind}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'shift') setTransform({ kind: 'shift', by: inch(1), alternate: true });
                else if (v === 'sequence') return;
                else setTransform({ kind: v as 'none' | 'flipAlternate' | 'rotate180Alternate' | 'reverseAlternate' });
              }}
            >
              <option value="none">As cut (no change)</option>
              <option value="flipAlternate">{angled ? 'Flip alternate — chevron' : 'Flip alternate — checkerboard'}</option>
              <option value="rotate180Alternate">Rotate 180° alternate</option>
              <option value="reverseAlternate">Reverse alternate</option>
              <option value="shift">Shift — brick / stagger</option>
              {transformKind === 'sequence' && <option value="sequence">Custom (slice arranger)</option>}
            </select>
          </label>
          {transformKind === 'shift' && (
            <div className="row indent">
              <span>Offset by</span>
              <DimInput
                value={(c as EndConstruction & { transform: { kind: 'shift'; by: Nm; alternate: boolean } }).transform.by}
                onCommit={(nm) =>
                  updateBoard((d) => {
                    const t = (d.construction as EndConstruction).transform;
                    if (t.kind === 'shift') t.by = nm;
                  })
                }
              />
              <label className="chk">
                <input
                  type="checkbox"
                  checked={(c as EndConstruction & { transform: { kind: 'shift'; alternate: boolean } }).transform.alternate}
                  onChange={(e) =>
                    updateBoard((d) => {
                      const t = (d.construction as EndConstruction).transform;
                      if (t.kind === 'shift') t.alternate = e.target.checked;
                    })
                  }
                />
                alternate rows
              </label>
            </div>
          )}
          {angled && (
            <label className="row">
              <span>Slice width</span>
              <DimInput
                value={(c as EndConstruction).crosscut.sliceWidth ?? inch(1.75)}
                onCommit={(nm) =>
                  updateBoard((d) => {
                    (d.construction as EndConstruction).crosscut.sliceWidth = nm;
                  })
                }
              />
            </label>
          )}
        </>
      )}

      <h3>Board</h3>
      {isPatch ? (
        // The lattice *is* the board — editing length/width here would just be
        // overwritten, so say where the size actually comes from.
        <div className="row hint-row">
          <span>Size</span>
          <span className="hint">
            follows the lattice — set columns, rows, and cell size in the studio
          </span>
        </div>
      ) : (
        <>
          <label className="row">
            <span>Length</span>
            <DimInput value={board.targetLength} onCommit={(nm) => updateBoard((d) => void (d.targetLength = nm))} />
          </label>
          {explicitWidth ? (
            <label className="row">
              <span>Width</span>
              <DimInput value={board.targetWidth} onCommit={(nm) => updateBoard((d) => void (d.targetWidth = nm))} />
            </label>
          ) : (
            <div className="row hint-row">
              <span>Width</span>
              <span className="hint">derived from the strip stack</span>
            </div>
          )}
        </>
      )}
      <label className="row">
        <span>Stock thickness</span>
        <DimInput value={board.stockThickness} onCommit={(nm) => updateBoard((d) => void (d.stockThickness = nm))} />
      </label>
      {isEnd && !angled && (
        <label className="row">
          <span>Final thickness</span>
          <DimInput value={board.finishedThickness} onCommit={(nm) => updateBoard((d) => void (d.finishedThickness = nm))} />
        </label>
      )}
      <label className="row">
        <span>Kerf</span>
        <DimInput value={board.kerf} onCommit={(nm) => updateBoard((d) => void (d.kerf = nm))} width={60} />
      </label>

      <h3>Shape <span className="hint">cut from the blank</span></h3>
      <OutlineControls />

      <details className="advanced">
        <summary>Allowances &amp; stock</summary>
        <label className="row"><span>Edge cleanup</span>
          <DimInput value={board.cleanup.widthTrim} onCommit={(nm) => updateBoard((d) => void (d.cleanup.widthTrim = nm))} width={60} />
        </label>
        <label className="row"><span>End trim</span>
          <DimInput value={board.cleanup.lengthTrim} onCommit={(nm) => updateBoard((d) => void (d.cleanup.lengthTrim = nm))} width={60} />
        </label>
        <label className="row"><span>Planing loss</span>
          <DimInput value={board.cleanup.planingLoss} onCommit={(nm) => updateBoard((d) => void (d.cleanup.planingLoss = nm))} width={60} />
        </label>
        <label className="row"><span>Waste factor</span>
          <span>
            <input
              type="number"
              min={0}
              max={60}
              value={Math.round(board.wasteFactor * 100)}
              style={{ width: 52 }}
              onChange={(e) => updateBoard((d) => void (d.wasteFactor = Math.max(0, Number(e.target.value)) / 100))}
            />{' '}
            %
          </span>
        </label>
        <label className="row"><span>Stock</span>
          <select value={board.roughStock ? 'rough' : 's4s'} onChange={(e) => updateBoard((d) => void (d.roughStock = e.target.value === 'rough'))}>
            <option value="rough">Rough (+1/4″ milling)</option>
            <option value="s4s">S4S</option>
          </select>
        </label>
        {(angled || diagonal) && (
          <label className="row"><span>Pattern offset</span>
            <DimInput
              value={board.patternOffset}
              onCommit={(nm) => updateBoard((d) => void (d.patternOffset = nm))}
              min={-inch(48)}
            />
          </label>
        )}
      </details>

      {c.kind !== 'blocks' && (
        <>
      <h3>
        Layer stack
        <span className="hint"> (glue-up #1, left → right)</span>
      </h3>
      <div className="groups">
        {board.construction.layers.map((group, gi) => (
          <GroupCard key={gi} group={group} gi={gi} />
        ))}
        <button
          className="add-group"
          onClick={() =>
            updateBoard((d) => {
              const last = d.construction.layers[d.construction.layers.length - 1];
              const species = last?.strips[0]?.species ?? 'hard-maple';
              d.construction.layers.push({ strips: [{ species, width: inch(1.5) }], repeat: 1 });
            })
          }
        >
          + Add group
        </button>
      </div>
        </>
      )}
    </div>
  );

  function GroupCard({ group, gi }: { group: LayerGroup; gi: number }) {
    return (
      <div className="group-card">
        <div className="group-head">
          <span className="group-repeat">
            <input
              type="number"
              min={1}
              max={40}
              value={group.repeat}
              onChange={(e) =>
                updateBoard((d) => {
                  d.construction.layers[gi].repeat = Math.max(1, Math.floor(Number(e.target.value) || 1));
                })
              }
            />
            ×
          </span>
          <span className="group-tools">
            <button title="Move up" disabled={gi === 0} onClick={() => updateBoard((d) => {
              const L = d.construction.layers;
              [L[gi - 1], L[gi]] = [L[gi], L[gi - 1]];
            })}>↑</button>
            <button title="Move down" disabled={gi === board.construction.layers.length - 1} onClick={() => updateBoard((d) => {
              const L = d.construction.layers;
              [L[gi + 1], L[gi]] = [L[gi], L[gi + 1]];
            })}>↓</button>
            <button title="Duplicate group" onClick={() => updateBoard((d) => {
              const L = d.construction.layers;
              L.splice(gi + 1, 0, JSON.parse(JSON.stringify(L[gi])) as LayerGroup);
            })}>⧉</button>
            <button title="Remove group" disabled={board.construction.layers.length === 1} onClick={() => updateBoard((d) => {
              d.construction.layers.splice(gi, 1);
            })}>✕</button>
          </span>
        </div>
        {group.strips.map((strip, si) => {
          const v = visual(strip.species);
          const selected = selection?.group === gi && selection?.strip === si;
          return (
            <div key={si} className={`strip-row ${selected ? 'strip-selected' : ''}`}>
              <button
                className="swatch"
                style={{ background: v.hex }}
                title={`${v.name} — click, then pick a species on the right`}
                onClick={() => {
                  select(selected ? null : { group: gi, strip: si });
                  if (!selected) setSpeciesTab('browse');
                }}
              >
                {v.letter}
              </button>
              <DimInput
                value={strip.width}
                onCommit={(nm) =>
                  updateBoard((d) => {
                    d.construction.layers[gi].strips[si].width = nm;
                  })
                }
                width={64}
              />
              <span className="strip-tools">
                <button title="Move left" disabled={si === 0} onClick={() => updateBoard((d) => {
                  const S = d.construction.layers[gi].strips;
                  [S[si - 1], S[si]] = [S[si], S[si - 1]];
                })}>↑</button>
                <button title="Move right" disabled={si === group.strips.length - 1} onClick={() => updateBoard((d) => {
                  const S = d.construction.layers[gi].strips;
                  [S[si + 1], S[si]] = [S[si], S[si + 1]];
                })}>↓</button>
                <button title="Duplicate strip" onClick={() => updateBoard((d) => {
                  const S = d.construction.layers[gi].strips;
                  S.splice(si + 1, 0, { ...S[si] });
                })}>⧉</button>
                <button title="Remove strip" disabled={group.strips.length === 1} onClick={() => updateBoard((d) => {
                  d.construction.layers[gi].strips.splice(si, 1);
                  select(null);
                })}>✕</button>
              </span>
            </div>
          );
        })}
      </div>
    );
  }
}
