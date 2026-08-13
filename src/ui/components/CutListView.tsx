import { formatCutDim, formatDim, IN } from '../../engine/units';
import type { CutList } from '../../engine/cutlist/cutlist';
import type { PipelineResult } from '../../engine/construction/types';
import { formatSliceList } from '../../exports/shared';
import { useStore } from '../../store/store';
import { useSpeciesVisual } from '../hooks';

export function CutListView({ result, cutlist }: { result: PipelineResult; cutlist: CutList }) {
  const units = useStore((s) => s.units);
  const visual = useSpeciesVisual();
  const f = (nm: number) => formatCutDim(nm, units);

  return (
    <div className="cutlist">
      <h3>Rip schedule <span className="hint">glue-up #1</span></h3>
      <table>
        <thead>
          <tr><th /><th>Species</th><th>Qty</th><th>Width</th><th>Thick</th><th>Length</th></tr>
        </thead>
        <tbody>
          {cutlist.ripSchedule.map((g, i) => {
            const v = visual(g.species);
            return (
              <tr key={i}>
                <td><span className="species-swatch sm" style={{ background: v.hex }} /></td>
                <td>{v.name}</td>
                <td className="num">{g.count}</td>
                <td className="num">{f(g.width)}</td>
                <td className="num">{f(g.thickness)}</td>
                <td className="num">{f(g.length)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {cutlist.crosscut && (
        <>
          <h3>Crosscut <span className="hint">glue-up #2</span></h3>
          <table>
            <tbody>
              <tr><td>Slices</td><td className="num">{cutlist.crosscut.sliceCount}</td></tr>
              <tr><td>Slice width</td><td className="num">{f(cutlist.crosscut.sliceWidth)}</td></tr>
              <tr><td>Angle</td><td className="num">{cutlist.crosscut.angleDeg}°</td></tr>
              {cutlist.crosscut.reversed.length > 0 && (
                <tr><td>Rotate 180°</td><td className="num">{formatSliceList(cutlist.crosscut.reversed)}</td></tr>
              )}
              {cutlist.crosscut.mirrored.length > 0 && (
                <tr><td>Flip face-down</td><td className="num">{formatSliceList(cutlist.crosscut.mirrored)}</td></tr>
              )}
              {cutlist.crosscut.shifted.length > 0 && (
                <tr>
                  <td>Shifted</td>
                  <td className="num">{cutlist.crosscut.shifted.map((s) => `#${s.slice} by ${f(s.by)}`).join(', ')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      <h3>Materials</h3>
      <table>
        <thead>
          <tr><th /><th>Species</th><th>Strips</th><th>Raw rip width</th><th>Board feet</th><th>Cost</th></tr>
        </thead>
        <tbody>
          {cutlist.perSpecies.map((s) => {
            const v = visual(s.species);
            return (
              <tr key={s.species} title={s.purchaseSuggestion}>
                <td><span className="species-swatch sm" style={{ background: v.hex }} /></td>
                <td>{v.name}</td>
                <td className="num">{s.stripCount}</td>
                <td className="num">{f(s.rawWidthNeeded)}</td>
                <td className="num">{s.boardFeetRough.toFixed(2)}</td>
                <td className="num">{s.costEstimate !== undefined ? `$${s.costEstimate.toFixed(0)}` : '—'}</td>
              </tr>
            );
          })}
          <tr className="total-row">
            <td /><td>Total</td><td /><td />
            <td className="num">{cutlist.totals.boardFeetRough.toFixed(2)}</td>
            <td className="num">{cutlist.totals.costEstimate !== undefined ? `$${cutlist.totals.costEstimate.toFixed(0)}` : '—'}</td>
          </tr>
        </tbody>
      </table>

      <h3>Allowances <span className="hint">audit these before cutting</span></h3>
      <table>
        <tbody>
          <tr><td>Kerf</td><td className="num">{formatDim(cutlist.allowances.kerf, units)}</td></tr>
          <tr><td>Edge cleanup</td><td className="num">{formatDim(cutlist.allowances.widthTrim, units)}</td></tr>
          <tr><td>End trim</td><td className="num">{formatDim(cutlist.allowances.lengthTrim, units)}</td></tr>
          <tr><td>Planing loss / glue-up</td><td className="num">{formatDim(cutlist.allowances.planingLoss, units)}</td></tr>
          <tr><td>Waste factor</td><td className="num">{Math.round(cutlist.allowances.wasteFactor * 100)}%</td></tr>
          <tr><td>Stock</td><td className="num">{cutlist.allowances.roughStock ? 'rough' : 'S4S'}</td></tr>
          <tr><td>Slab</td><td className="num">{f(result.glueUp1.slabWidth)} × {f(result.glueUp1.slabLength)}</td></tr>
          <tr>
            <td>Glue &amp; clamps</td>
            <td className="num">
              {Math.max(1, Math.ceil(cutlist.glue.glueOzEstimate))} fl oz · {cutlist.glue.glueUp1Clamps}
              {cutlist.glue.glueUp2Clamps ? ` + ${cutlist.glue.glueUp2Clamps}` : ''} clamps
            </td>
          </tr>
        </tbody>
      </table>

      {cutlist.rounding.entries.length > 0 && (
        <>
          <h3>
            Rounding report{' '}
            <span className={cutlist.rounding.driftWarning ? 'lint-warn' : 'hint'}>
              {cutlist.rounding.driftWarning ? '⚠ drift exceeds kerf/2' : 'within tolerance'}
            </span>
          </h3>
          <table>
            <thead><tr><th>Dimension</th><th>Shown</th><th>Exact</th></tr></thead>
            <tbody>
              {cutlist.rounding.entries.slice(0, 10).map((e, i) => (
                <tr key={i}>
                  <td>{e.label}</td>
                  <td className="num">{f(e.rounded)}</td>
                  <td className="num">{(e.exact / IN).toFixed(4)}″</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
