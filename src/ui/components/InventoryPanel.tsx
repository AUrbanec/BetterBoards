import { useMemo, useState } from 'react';
import { SPECIES, SPECIES_BY_ID } from '../../data/species';
import { formatCutDim, IN, inch } from '../../engine/units';
import { packStock, type StockBoard } from '../../engine/cutlist/optimizer';
import { useStore } from '../../store/store';
import { useDerived } from '../hooks';
import type { InventoryItem } from '../../exports/project';

/**
 * "My lumber" inventory: feeds the recommender's inventory-only filter and
 * overrides the price used in cost estimates.
 */
export function InventoryPanel() {
  const inventory = useStore((s) => s.inventory);
  const setInventory = useStore((s) => s.setInventory);
  const [adding, setAdding] = useState('');

  const update = (i: number, patch: Partial<InventoryItem>) => {
    const next = inventory.map((item, idx) => (idx === i ? { ...item, ...patch } : item));
    setInventory(next);
  };

  const add = (species: string) => {
    if (!species || inventory.some((i) => i.species === species)) return;
    const s = SPECIES_BY_ID.get(species);
    setInventory([...inventory, { species, boardFeet: 0, pricePerBF: s?.avgPricePerBF_usd }]);
    setAdding('');
  };

  const unowned = SPECIES.filter((s) => !inventory.some((i) => i.species === s.id));

  return (
    <div className="inventory">
      <p className="hint">
        Track what's in your rack. Prices here override the defaults in cost estimates, and the recommender can restrict
        matches to species you already own.
      </p>
      {inventory.length === 0 && <p className="hint">Nothing yet — add a species below.</p>}
      <table className="inv-table">
        {inventory.length > 0 && (
          <thead>
            <tr>
              <th>Species</th>
              <th>bf</th>
              <th>$/bf</th>
              <th>board</th>
              <th>#</th>
              <th />
            </tr>
          </thead>
        )}
        <tbody>
          {inventory.map((item, i) => {
            const s = SPECIES_BY_ID.get(item.species);
            return (
              <tr key={item.species}>
                <td>
                  <span className="species-swatch sm" style={{ background: s?.displayHex ?? '#ccc' }} />
                  {s?.commonName ?? item.species}
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={item.boardFeet}
                    onChange={(e) => update(i, { boardFeet: Math.max(0, Number(e.target.value)) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={item.pricePerBF ?? ''}
                    onChange={(e) => update(i, { pricePerBF: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step={6}
                    placeholder="in"
                    value={item.boardLength ? Math.round(item.boardLength / IN) : ''}
                    onChange={(e) =>
                      update(i, { boardLength: e.target.value === '' ? undefined : inch(Math.max(0, Number(e.target.value))) })
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    value={item.boardCount ?? ''}
                    onChange={(e) => update(i, { boardCount: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                  />
                </td>
                <td>
                  <button onClick={() => setInventory(inventory.filter((_, idx) => idx !== i))}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <select value={adding} onChange={(e) => add(e.target.value)}>
          <option value="">+ Add species…</option>
          {unowned.map((s) => (
            <option key={s.id} value={s.id}>
              {s.commonName}
            </option>
          ))}
        </select>
      </div>

      <StockOptimizer />
    </div>
  );
}

/**
 * First-fit-decreasing packing of this project's rip schedule onto the boards
 * on hand. Length packing per part — it does not pretend to solve 2-D nesting.
 */
function StockOptimizer() {
  const inventory = useStore((s) => s.inventory);
  const units = useStore((s) => s.units);
  const board = useStore((s) => s.board);
  const { cutlist, info } = useDerived();

  const stock: StockBoard[] = useMemo(
    () =>
      inventory
        .filter((i) => (i.boardLength ?? 0) > 0 && (i.boardCount ?? 0) > 0)
        .map((i) => ({ species: i.species, length: i.boardLength!, count: i.boardCount! })),
    [inventory],
  );

  const result = useMemo(
    () => (stock.length ? packStock(cutlist.ripSchedule, stock, board.kerf) : null),
    [cutlist.ripSchedule, stock, board.kerf],
  );

  if (!result) {
    return (
      <>
        <h3>Stock optimizer</h3>
        <p className="hint">
          Set a board length and count above for at least one species and this will pack the project's parts onto the
          boards you own.
        </p>
      </>
    );
  }

  const f = (nm: number) => formatCutDim(nm, units);

  return (
    <>
      <h3>Stock optimizer</h3>
      <p className="hint">
        {result.boards.length} board{result.boards.length === 1 ? '' : 's'} · {Math.round(result.utilization * 100)}% of
        their length used · {f(result.usableOffcut)} of offcut worth keeping.
      </p>
      {result.shortfall.length > 0 && (
        <p className="hint lint-warn">
          ⚠ Short by{' '}
          {result.shortfall
            .map((s) => `${s.count} × ${f(s.length)} ${info(s.species)?.name ?? s.species}`)
            .join(', ')}
          .
        </p>
      )}
      {result.unplaced.length > 0 && (
        <p className="hint lint-err">
          ✖ {result.unplaced.length} part{result.unplaced.length === 1 ? '' : 's'} will not fit any board you own —
          longest is {f(Math.max(...result.unplaced.map((p) => p.length)))}.
        </p>
      )}
      <div className="pack-list">
        {result.boards.slice(0, 12).map((b, i) => (
          <div key={i} className="pack-board" title={`${b.parts.length} parts, ${f(b.offcut)} offcut`}>
            <span className="pack-label">
              {info(b.species)?.name ?? b.species} {f(b.length)}
            </span>
            <span className="pack-bar">
              {b.parts.map((p, j) => (
                <i key={j} style={{ flexGrow: p.length, background: SPECIES_BY_ID.get(p.species)?.displayHex }} />
              ))}
              <i className="pack-offcut" style={{ flexGrow: Math.max(0, b.offcut) }} />
            </span>
          </div>
        ))}
        {result.boards.length > 12 && <p className="hint">…and {result.boards.length - 12} more.</p>}
      </div>
    </>
  );
}
