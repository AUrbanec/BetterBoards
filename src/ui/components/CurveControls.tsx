import { inch } from '../../engine/units';
import type { BoardSpec } from '../../engine/construction/types';
import type { CurvePattern } from '../../engine/patterns/curves';
import { SPECIES } from '../../data/species';
import { useStore } from '../../store/store';
import { DimInput } from './DimInput';

type CurveConstruction = Extract<BoardSpec['construction'], { kind: 'curve' }>;

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

export function CurveControls() {
  const board = useStore((s) => s.board);
  const updateBoard = useStore((s) => s.updateBoard);
  const pattern = (board.construction as CurveConstruction).pattern;

  const mutate = (fn: (p: CurvePattern) => void) =>
    updateBoard((d) => {
      fn((d.construction as CurveConstruction).pattern);
    });

  return (
    <>
      <label className="row">
        <span>Curve</span>
        <select value={pattern.shape} onChange={(e) => mutate((p) => void (p.shape = e.target.value as 'arch' | 'lens'))}>
          <option value="arch">Arch — one parabola</option>
          <option value="lens">Lens — two mirrored</option>
        </select>
      </label>
      <label className="row indent">
        <span>Columns</span>
        <input
          type="number"
          min={2}
          max={60}
          value={pattern.columns}
          onChange={(e) => mutate((p) => void (p.columns = Math.max(2, Math.min(60, Number(e.target.value)))))}
          style={{ width: 60 }}
        />
      </label>
      <p className="hint indent-p">
        One straight crosscut per column. More columns, smoother curve — and one more little glue-up each.
      </p>
      <label className="row indent">
        <span>Rise</span>
        <input
          type="range"
          min={10}
          max={90}
          value={Math.round(pattern.rise * 100)}
          onChange={(e) => mutate((p) => void (p.rise = Number(e.target.value) / 100))}
        />
        <span className="hint">{Math.round(pattern.rise * 100)}%</span>
      </label>
      {pattern.shape === 'arch' && (
        <label className="row indent chk">
          <input type="checkbox" checked={pattern.inverted} onChange={(e) => mutate((p) => void (p.inverted = e.target.checked))} />
          flip the arch
        </label>
      )}
      <SpeciesSelect
        label={pattern.shape === 'lens' ? 'Lens' : 'Below'}
        value={pattern.speciesLow}
        onChange={(id) => mutate((p) => void (p.speciesLow = id))}
      />
      <SpeciesSelect
        label={pattern.shape === 'lens' ? 'Field' : 'Above'}
        value={pattern.speciesHigh}
        onChange={(id) => mutate((p) => void (p.speciesHigh = id))}
      />
      <label className="row indent">
        <span>Accent</span>
        <select
          value={pattern.accent ?? ''}
          onChange={(e) =>
            mutate((p) => {
              p.accent = e.target.value || undefined;
              if (p.accent && p.accentWidth <= 0) p.accentWidth = inch(0.125);
            })
          }
        >
          <option value="">None</option>
          {SPECIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.commonName}
            </option>
          ))}
        </select>
      </label>
      {pattern.accent && (
        <label className="row indent">
          <span>Accent width</span>
          <DimInput value={pattern.accentWidth} onCommit={(nm) => mutate((p) => void (p.accentWidth = nm))} width={58} />
        </label>
      )}
    </>
  );
}
