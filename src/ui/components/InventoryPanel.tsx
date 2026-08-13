import { useState } from 'react';
import { SPECIES, SPECIES_BY_ID } from '../../data/species';
import { useStore } from '../../store/store';
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
              <th>bf on hand</th>
              <th>$/bf</th>
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
    </div>
  );
}
