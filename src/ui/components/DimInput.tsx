import { useEffect, useState } from 'react';
import { formatDim, parseDim, type Nm, type UnitMode } from '../../engine/units';
import { useStore } from '../../store/store';

interface Props {
  value: Nm;
  onCommit: (nm: Nm) => void;
  min?: Nm;
  max?: Nm;
  width?: number;
  title?: string;
  disabled?: boolean;
}

/** Dimension input accepting `1 3/4`, `1.75`, `44mm` — commits on Enter/blur. */
export function DimInput({ value, onCommit, min, max, width = 78, title, disabled }: Props) {
  const units = useStore((s) => s.units);
  const display = formatDim(value, units, { showUnit: false, markApprox: false });
  const [text, setText] = useState(display);
  const [editing, setEditing] = useState(false);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (!editing) {
      setText(display);
      setBad(false);
    }
  }, [display, editing]);

  const commit = () => {
    setEditing(false);
    const parsed = parseDim(text, units === 'mm' ? 'mm' : 'in');
    const lo = min ?? 1; // dimensions are positive unless the caller loosens min
    if (parsed === null || parsed < lo || (max !== undefined && parsed > max)) {
      setBad(true);
      setText(display);
      setTimeout(() => setBad(false), 600);
      return;
    }
    onCommit(parsed);
  };

  return (
    <span className={`dim-input ${bad ? 'dim-bad' : ''}`}>
      <input
        style={{ width }}
        value={text}
        disabled={disabled}
        title={title}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(display);
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className="dim-unit">{units === 'mm' ? 'mm' : 'in'}</span>
    </span>
  );
}
