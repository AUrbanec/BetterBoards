import { useMemo, useState } from 'react';
import type { CutList } from '../../engine/cutlist/cutlist';
import type { PipelineResult } from '../../engine/construction/types';
import { buildPlan, type StageKind } from '../../exports/stages';
import { useStore } from '../../store/store';

const ICON: Record<StageKind, string> = {
  mill: '▤',
  rip: '▥',
  taper: '◺',
  cut: '✂',
  glue: '⊞',
  flatten: '▬',
  crosscut: '⊣',
  arrange: '⇄',
  dryfit: '◫',
  shape: '◠',
  trim: '⊡',
  finish: '✦',
};

interface Props {
  result: PipelineResult;
  cutlist: CutList;
  info: (id: string) => { name: string; pricePerBF?: number } | undefined;
}

/**
 * The build at a glance. Renders from the same plan the written instructions
 * use, so the glue-up count on screen is always the printed one.
 */
export function StagesBar({ result, cutlist, info }: Props) {
  const board = useStore((s) => s.board);
  const units = useStore((s) => s.units);
  const [open, setOpen] = useState<number | null>(null);

  const plan = useMemo(
    () => buildPlan(board, result, cutlist, info, units),
    [board, result, cutlist, info, units],
  );

  if (!result.ok) return null;

  const active = open !== null ? plan.stages.find((s) => s.index === open) : undefined;

  return (
    <div className="stages">
      <div className="stages-head">
        <b>
          {plan.glueUps} glue-up{plan.glueUps === 1 ? '' : 's'}
        </b>
        <span className="hint">
          · {plan.cuttingStages} machining stage{plan.cuttingStages === 1 ? '' : 's'} · {plan.stages.length} steps
        </span>
      </div>
      <div className="stage-chips">
        {plan.stages.map((s) => (
          <button
            key={s.index}
            className={`stage-chip stage-${s.kind} ${open === s.index ? 'stage-open' : ''}`}
            title={s.title}
            onClick={() => setOpen(open === s.index ? null : s.index)}
          >
            <i>{ICON[s.kind]}</i>
            <span>{s.short}</span>
            {s.glueUp !== undefined && <em>{s.glueUp}</em>}
          </button>
        ))}
      </div>
      {active && (
        <div className="stage-detail">
          <b>
            Step {active.index} — {active.title}
          </b>
          <p>{active.body}</p>
          {active.safety && <p className="safety">⚠ {active.safety}</p>}
        </div>
      )}
    </div>
  );
}
