import { inch } from '../../engine/units';
import type { BlockPattern } from '../../engine/patterns/blocks';
import type { BoardSpec } from '../../engine/construction/types';
import { SPECIES } from '../../data/species';
import { useStore } from '../../store/store';
import { DimInput } from './DimInput';

type BlockConstruction = Extract<BoardSpec['construction'], { kind: 'blocks' }>;

function SpeciesSelect({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  return (
    <label className="row indent">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {SPECIES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.commonName}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Block patterns are tilings placed by (i, j) rather than strip stacks, so they
 * get their own controls: unit size and one species per role.
 */
export function BlockControls() {
  const board = useStore((s) => s.board);
  const updateBoard = useStore((s) => s.updateBoard);
  const pattern = (board.construction as BlockConstruction).pattern;

  const setPattern = (next: BlockPattern) =>
    updateBoard((d) => {
      (d.construction as BlockConstruction).pattern = next;
    });

  const mutate = (fn: (p: BlockPattern) => void) =>
    updateBoard((d) => {
      fn((d.construction as BlockConstruction).pattern);
    });

  return (
    <>
      <label className="row">
        <span>Pattern</span>
        <select
          value={pattern.kind}
          onChange={(e) => {
            const kind = e.target.value as BlockPattern['kind'];
            if (kind === pattern.kind) return;
            if (kind === 'pinwheel') {
              setPattern({ kind: 'pinwheel', unit: inch(4.5), speciesA: 'black-walnut', speciesB: 'hard-maple' });
            } else if (kind === 'basketweave') {
              setPattern({ kind: 'basketweave', unit: inch(3), slats: 3, speciesA: 'black-cherry', speciesB: 'hard-maple' });
            } else {
              setPattern({
                kind: 'tumbling',
                side: inch(1.75),
                speciesA: 'hard-maple',
                speciesB: 'black-walnut',
                speciesC: 'black-cherry',
              });
            }
          }}
        >
          <option value="pinwheel">Pinwheel</option>
          <option value="basketweave">Basket weave</option>
          <option value="tumbling">Tumbling blocks</option>
        </select>
      </label>

      {pattern.kind === 'pinwheel' && (
        <>
          <label className="row indent">
            <span>Unit size</span>
            <DimInput value={pattern.unit} onCommit={(nm) => mutate((p) => { if (p.kind === 'pinwheel') p.unit = nm; })} />
          </label>
          <p className="hint indent-p">Each unit is four arms around a centre one-third that size.</p>
          <SpeciesSelect label="Species A" value={pattern.speciesA} onChange={(id) => mutate((p) => { if (p.kind === 'pinwheel') p.speciesA = id; })} />
          <SpeciesSelect label="Species B" value={pattern.speciesB} onChange={(id) => mutate((p) => { if (p.kind === 'pinwheel') p.speciesB = id; })} />
        </>
      )}

      {pattern.kind === 'basketweave' && (
        <>
          <label className="row indent">
            <span>Unit size</span>
            <DimInput value={pattern.unit} onCommit={(nm) => mutate((p) => { if (p.kind === 'basketweave') p.unit = nm; })} />
          </label>
          <label className="row indent">
            <span>Slats / unit</span>
            <input
              type="number"
              min={2}
              max={6}
              value={pattern.slats}
              onChange={(e) => mutate((p) => { if (p.kind === 'basketweave') p.slats = Math.max(2, Math.min(6, Number(e.target.value))); })}
              style={{ width: 52 }}
            />
          </label>
          <SpeciesSelect label="Horizontal" value={pattern.speciesA} onChange={(id) => mutate((p) => { if (p.kind === 'basketweave') p.speciesA = id; })} />
          <SpeciesSelect label="Vertical" value={pattern.speciesB} onChange={(id) => mutate((p) => { if (p.kind === 'basketweave') p.speciesB = id; })} />
        </>
      )}

      {pattern.kind === 'tumbling' && (
        <>
          <label className="row indent">
            <span>Rhombus side</span>
            <DimInput value={pattern.side} onCommit={(nm) => mutate((p) => { if (p.kind === 'tumbling') p.side = nm; })} />
          </label>
          <p className="hint indent-p">
            Three species, one per cube face — light on top, mid and dark on the sides, is what sells the illusion.
          </p>
          <SpeciesSelect label="Top face" value={pattern.speciesA} onChange={(id) => mutate((p) => { if (p.kind === 'tumbling') p.speciesA = id; })} />
          <SpeciesSelect label="Left face" value={pattern.speciesB} onChange={(id) => mutate((p) => { if (p.kind === 'tumbling') p.speciesB = id; })} />
          <SpeciesSelect label="Right face" value={pattern.speciesC} onChange={(id) => mutate((p) => { if (p.kind === 'tumbling') p.speciesC = id; })} />
        </>
      )}
    </>
  );
}
