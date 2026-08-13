import { formatDim, IN } from '../../engine/units';
import type { PipelineResult } from '../../engine/construction/types';
import { generateToolpaths } from '../../engine/cnc/toolpath';
import { unsupportedChars } from '../../engine/cnc/hershey';
import {
  MACHINES,
  TOOLS,
  defaultCncOptions,
  defaultFeeds,
  machineById,
  suggestedFeed,
  toolById,
  type CncOptions,
  type Tool,
} from '../../engine/cnc/types';
import { useStore } from '../../store/store';
import { DimInput } from './DimInput';

/** Ensure the board has CNC options, then mutate them. */
function useCnc(result: PipelineResult): [CncOptions, (fn: (c: CncOptions) => void) => void] {
  const board = useStore((s) => s.board);
  const updateBoard = useStore((s) => s.updateBoard);
  const cnc = board.cnc ?? defaultCncOptions(result.finished.thickness);
  const mutate = (fn: (c: CncOptions) => void) =>
    updateBoard((d) => {
      d.cnc = d.cnc ?? defaultCncOptions(result.finished.thickness);
      fn(d.cnc);
    });
  return [cnc, mutate];
}

function ToolPicker({ value, onChange }: { value: Tool; onChange: (t: Tool) => void }) {
  return (
    <select value={value.id} onChange={(e) => onChange(toolById(e.target.value))}>
      {TOOLS.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

function FeedRow({
  rpm,
  feedXY,
  tool,
  onRpm,
  onFeed,
}: {
  rpm: number;
  feedXY: number;
  tool: Tool;
  onRpm: (n: number) => void;
  onFeed: (n: number) => void;
}) {
  const suggested = suggestedFeed(tool, rpm);
  const off = Math.abs(feedXY - suggested) / Math.max(1, suggested) > 0.25;
  return (
    <>
      <label className="row indent">
        <span>RPM</span>
        <input type="number" step={500} min={1000} max={30000} value={rpm} onChange={(e) => onRpm(Number(e.target.value))} style={{ width: 74 }} />
      </label>
      <label className="row indent">
        <span>Feed (ipm)</span>
        <input
          type="number"
          step={5}
          min={1}
          value={Math.round(feedXY / IN)}
          onChange={(e) => onFeed(Math.max(1, Number(e.target.value)) * IN)}
          style={{ width: 74 }}
        />
        <button className="tiny" title="Use the chipload-based suggestion" onClick={() => onFeed(suggested)}>
          ↺ {Math.round(suggested / IN)}
        </button>
      </label>
      {off && (
        <p className="hint indent-p">
          Chipload math suggests ≈{Math.round(suggested / IN)} ipm at this RPM ({tool.flutes} flutes). Starting point only.
        </p>
      )}
    </>
  );
}

export function CncPanel({ result }: { result: PipelineResult }) {
  const [cnc, mutate] = useCnc(result);
  const units = useStore((s) => s.units);
  const paths = generateToolpaths(result.outline, cnc);
  const badChars = unsupportedChars(cnc.engrave.text);

  return (
    <div className="panel cnc-panel">
      <p className="hint">
        2.5-D operations only — profile, groove, pocket, and engraving. Feeds and speeds are published starting points:
        verify them against your machine, bit, and stock before cutting.
      </p>

      <h3>Machine</h3>
      <label className="row">
        <span>Profile</span>
        <select value={cnc.machine.id} onChange={(e) => mutate((c) => void (c.machine = machineById(e.target.value)))}>
          {MACHINES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        <span>Safe Z</span>
        <DimInput value={cnc.machine.safeZ} onCommit={(nm) => mutate((c) => void (c.machine = { ...c.machine, safeZ: nm }))} width={60} />
      </label>
      <label className="row">
        <span>Stock thickness</span>
        <DimInput value={cnc.stockThickness} onCommit={(nm) => mutate((c) => void (c.stockThickness = nm))} width={60} />
      </label>

      {/* ---- profile ---- */}
      <h3>
        <label className="chk">
          <input type="checkbox" checked={cnc.profile.enabled} onChange={(e) => mutate((c) => void (c.profile.enabled = e.target.checked))} />
          Perimeter profile
        </label>
      </h3>
      {cnc.profile.enabled && (
        <>
          <label className="row indent">
            <span>Bit</span>
            <ToolPicker
              value={cnc.profile.tool}
              onChange={(t) => mutate((c) => { c.profile.tool = t; c.profile.feeds = defaultFeeds(t, c.profile.feeds.rpm); })}
            />
          </label>
          <label className="row indent">
            <span>Direction</span>
            <select value={cnc.profile.direction} onChange={(e) => mutate((c) => void (c.profile.direction = e.target.value as 'climb' | 'conventional'))}>
              <option value="climb">Climb</option>
              <option value="conventional">Conventional</option>
            </select>
          </label>
          <label className="row indent">
            <span>Stepdown</span>
            <DimInput value={cnc.profile.feeds.stepdown} onCommit={(nm) => mutate((c) => void (c.profile.feeds.stepdown = nm))} width={58} />
          </label>
          <label className="row indent">
            <span>Tabs</span>
            <input
              type="number"
              min={0}
              max={12}
              value={cnc.profile.tabs.count}
              onChange={(e) => mutate((c) => void (c.profile.tabs.count = Math.max(0, Number(e.target.value))))}
              style={{ width: 52 }}
            />
            <DimInput value={cnc.profile.tabs.width} onCommit={(nm) => mutate((c) => void (c.profile.tabs.width = nm))} width={54} />
            <DimInput value={cnc.profile.tabs.height} onCommit={(nm) => mutate((c) => void (c.profile.tabs.height = nm))} width={54} />
          </label>
          <p className="hint indent-p">count · width · height. Tabs must be at least 1.5× the bit diameter.</p>
          <FeedRow
            rpm={cnc.profile.feeds.rpm}
            feedXY={cnc.profile.feeds.feedXY}
            tool={cnc.profile.tool}
            onRpm={(n) => mutate((c) => void (c.profile.feeds.rpm = n))}
            onFeed={(n) => mutate((c) => void (c.profile.feeds.feedXY = n))}
          />
        </>
      )}

      {/* ---- groove ---- */}
      <h3>
        <label className="chk">
          <input type="checkbox" checked={cnc.groove.enabled} onChange={(e) => mutate((c) => void (c.groove.enabled = e.target.checked))} />
          Juice groove
        </label>
      </h3>
      {cnc.groove.enabled && (
        <>
          <label className="row indent">
            <span>Bit</span>
            <ToolPicker value={cnc.groove.tool} onChange={(t) => mutate((c) => { c.groove.tool = t; c.groove.feeds = defaultFeeds(t, c.groove.feeds.rpm); })} />
          </label>
          <label className="row indent">
            <span>Margin</span>
            <DimInput value={cnc.groove.margin} onCommit={(nm) => mutate((c) => void (c.groove.margin = nm))} width={58} />
          </label>
          <label className="row indent">
            <span>Depth</span>
            <DimInput value={cnc.groove.depth} onCommit={(nm) => mutate((c) => void (c.groove.depth = nm))} width={58} />
          </label>
          <FeedRow
            rpm={cnc.groove.feeds.rpm}
            feedXY={cnc.groove.feeds.feedXY}
            tool={cnc.groove.tool}
            onRpm={(n) => mutate((c) => void (c.groove.feeds.rpm = n))}
            onFeed={(n) => mutate((c) => void (c.groove.feeds.feedXY = n))}
          />
        </>
      )}

      {/* ---- pocket ---- */}
      <h3>
        <label className="chk">
          <input type="checkbox" checked={cnc.pocket.enabled} onChange={(e) => mutate((c) => void (c.pocket.enabled = e.target.checked))} />
          Handle recess
        </label>
      </h3>
      {cnc.pocket.enabled && (
        <>
          <label className="row indent">
            <span>Bit</span>
            <ToolPicker value={cnc.pocket.tool} onChange={(t) => mutate((c) => { c.pocket.tool = t; c.pocket.feeds = defaultFeeds(t, c.pocket.feeds.rpm); })} />
          </label>
          <label className="row indent">
            <span>Size</span>
            <DimInput value={cnc.pocket.placement.w} onCommit={(nm) => mutate((c) => void (c.pocket.placement.w = nm))} width={54} />
            <DimInput value={cnc.pocket.placement.h} onCommit={(nm) => mutate((c) => void (c.pocket.placement.h = nm))} width={54} />
          </label>
          <label className="row indent">
            <span>Depth</span>
            <DimInput value={cnc.pocket.depth} onCommit={(nm) => mutate((c) => void (c.pocket.depth = nm))} width={58} />
          </label>
          <label className="row indent">
            <span>Position</span>
            <input type="range" min={5} max={95} value={Math.round(cnc.pocket.placement.cx * 100)} onChange={(e) => mutate((c) => void (c.pocket.placement.cx = Number(e.target.value) / 100))} />
            <input type="range" min={5} max={95} value={Math.round(cnc.pocket.placement.cy * 100)} onChange={(e) => mutate((c) => void (c.pocket.placement.cy = Number(e.target.value) / 100))} />
          </label>
        </>
      )}

      {/* ---- engrave ---- */}
      <h3>
        <label className="chk">
          <input type="checkbox" checked={cnc.engrave.enabled} onChange={(e) => mutate((c) => void (c.engrave.enabled = e.target.checked))} />
          Engraving
        </label>
      </h3>
      {cnc.engrave.enabled && (
        <>
          <label className="row indent">
            <span>Text</span>
            <input value={cnc.engrave.text} onChange={(e) => mutate((c) => void (c.engrave.text = e.target.value))} style={{ flex: 1, minWidth: 0 }} />
          </label>
          {badChars.length > 0 && (
            <p className="hint indent-p lint-warn">
              Not in the single-line font, and will be skipped: {badChars.join(' ')}
            </p>
          )}
          <p className="hint indent-p">Engraves as uppercase — a single-stroke font, cut as centerlines with a V-bit.</p>
          <label className="row indent">
            <span>Cap height</span>
            <DimInput value={cnc.engrave.size} onCommit={(nm) => mutate((c) => void (c.engrave.size = nm))} width={58} />
          </label>
          <label className="row indent">
            <span>Depth</span>
            <DimInput value={cnc.engrave.depth} onCommit={(nm) => mutate((c) => void (c.engrave.depth = nm))} width={58} />
          </label>
          <label className="row indent">
            <span>Position</span>
            <input type="range" min={5} max={95} value={Math.round(cnc.engrave.placement.cx * 100)} onChange={(e) => mutate((c) => void (c.engrave.placement.cx = Number(e.target.value) / 100))} />
            <input type="range" min={5} max={95} value={Math.round(cnc.engrave.placement.cy * 100)} onChange={(e) => mutate((c) => void (c.engrave.placement.cy = Number(e.target.value) / 100))} />
          </label>
        </>
      )}

      {(paths.errors.length > 0 || paths.warnings.length > 0) && (
        <>
          <h3>Checks</h3>
          {paths.errors.map((e, i) => (
            <p key={`e${i}`} className="lint-err">✖ {e}</p>
          ))}
          {[...new Set(paths.warnings)].map((w, i) => (
            <p key={`w${i}`} className="lint-warn">⚠ {w}</p>
          ))}
        </>
      )}

      <h3>Before you cut</h3>
      <ul className="checklist">
        <li>Preview the toolpaths in the CNC view — that is exactly what gets posted.</li>
        <li>Air-cut the program above the work with Z raised.</li>
        <li>Confirm the stock is {formatDim(cnc.stockThickness, units)} thick and workholding clears every path.</li>
        <li>Zero X/Y at the board's top-left corner and Z at the top of the stock.</li>
      </ul>
    </div>
  );
}
