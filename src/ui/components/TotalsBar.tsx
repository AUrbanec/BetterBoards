import { useState } from 'react';
import { formatCutDim } from '../../engine/units';
import type { CutList } from '../../engine/cutlist/cutlist';
import type { Lint } from '../../engine/validate/rules';
import type { PipelineResult } from '../../engine/construction/types';
import { useStore } from '../../store/store';
import { useSpeciesVisual } from '../hooks';

export function TotalsBar({ result, cutlist, lints }: { result: PipelineResult; cutlist: CutList; lints: Lint[] }) {
  const units = useStore((s) => s.units);
  const visual = useSpeciesVisual();
  const [open, setOpen] = useState(false);
  const errors = lints.filter((l) => l.level === 'error');
  const warnings = lints.filter((l) => l.level === 'warning');

  return (
    <div className="totals-bar">
      {open && (
        <div className="lint-popover">
          <div className="lint-head">
            <b>Design checks</b>
            <button onClick={() => setOpen(false)}>✕</button>
          </div>
          {lints.length === 0 && <div className="lint-item">✓ No warnings — clean design.</div>}
          {[...errors, ...warnings].map((l, i) => (
            <details key={i} className="lint-item">
              <summary>
                <span className={l.level === 'error' ? 'lint-err' : 'lint-warn'}>{l.level === 'error' ? '✖' : '⚠'}</span> {l.message}
              </summary>
              {l.why && <p>{l.why}</p>}
            </details>
          ))}
        </div>
      )}
      <span className="totals-dims">
        {result.ok
          ? `${formatCutDim(result.finished.length, units)} × ${formatCutDim(result.finished.width, units)} × ${formatCutDim(result.finished.thickness, units)}`
          : '—'}
      </span>
      <span className="totals-species">
        {cutlist.perSpecies.map((s) => {
          const v = visual(s.species);
          return (
            <span key={s.species} className="chip" title={`${v.name}: ${s.stripCount} strips, ${s.boardFeetRough.toFixed(2)} bf`}>
              <i style={{ background: v.hex }} />
              {v.letter} {s.boardFeetRough.toFixed(1)} bf
            </span>
          );
        })}
      </span>
      <span className="totals-cost">
        {cutlist.totals.boardFeetRough.toFixed(1)} bf
        {cutlist.totals.costEstimate !== undefined && ` ≈ $${cutlist.totals.costEstimate.toFixed(0)}`}
      </span>
      <button className={`totals-lint ${errors.length ? 'has-err' : warnings.length ? 'has-warn' : ''}`} onClick={() => setOpen(!open)}>
        {errors.length ? `✖ ${errors.length} ` : ''}⚠ {warnings.length}
      </button>
    </div>
  );
}
