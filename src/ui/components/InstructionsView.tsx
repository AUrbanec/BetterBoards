import { useMemo } from 'react';
import type { CutList } from '../../engine/cutlist/cutlist';
import type { PipelineResult } from '../../engine/construction/types';
import { generateInstructions } from '../../exports/instructions';
import { useStore } from '../../store/store';

interface Props {
  result: PipelineResult;
  cutlist: CutList;
  info: (id: string) => { name: string; pricePerBF?: number } | undefined;
}

export function InstructionsView({ result, cutlist, info }: Props) {
  const board = useStore((s) => s.board);
  const units = useStore((s) => s.units);
  const ins = useMemo(
    () => generateInstructions(board, result, cutlist, info, units),
    [board, result, cutlist, info, units],
  );

  return (
    <div className="instructions">
      <p className="hint">{ins.intro}</p>
      <ol>
        {ins.steps.map((s) => (
          <li key={s.n}>
            <b>{s.title}</b>
            <p>{s.body}</p>
            {s.safety && <p className="safety">⚠ {s.safety}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
