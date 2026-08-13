import { useMemo, useState } from 'react';
import { SPECIES, SPECIES_BY_ID } from '../../data/species';
import { hexToLab, matchBadge, type Lab } from '../../engine/color/color';
import {
  DEFAULT_FILTERS,
  recommendSpecies,
  suggestCompanions,
  type CandidateSpecies,
  type RecommendFilters,
} from '../../engine/color/recommend';
import { expandLayers } from '../../engine/construction/types';
import { useStore } from '../../store/store';
import { InventoryPanel } from './InventoryPanel';

const CANDIDATES: CandidateSpecies[] = SPECIES.map((s) => ({
  id: s.id,
  colorLab: s.colorLab,
  janka_lbf: s.janka_lbf,
  foodSafe: s.foodSafe,
  porosity: s.porosity,
  pricePerBF: s.avgPricePerBF_usd,
}));

export function SpeciesPanel() {
  const tab = useStore((s) => s.speciesTab);
  const setTab = useStore((s) => s.setSpeciesTab);
  return (
    <div className="panel species-panel">
      <div className="row seg">
        <button className={tab === 'browse' ? 'seg-on' : ''} onClick={() => setTab('browse')}>Browse</button>
        <button className={tab === 'match' ? 'seg-on' : ''} onClick={() => setTab('match')}>Match a color</button>
        <button className={tab === 'inventory' ? 'seg-on' : ''} onClick={() => setTab('inventory')}>Inventory</button>
      </div>
      {tab === 'browse' && <BrowseTab />}
      {tab === 'match' && <MatchTab />}
      {tab === 'inventory' && <InventoryPanel />}
    </div>
  );
}

/** Filters plus the UI-only "restrict to inventory" toggle. */
type UiFilters = RecommendFilters & { inventoryOnly: boolean };

function useFilters(): [UiFilters, (f: Partial<UiFilters>) => void] {
  const inventory = useStore((s) => s.inventory);
  const [state, setState] = useState<UiFilters>({ ...DEFAULT_FILTERS, inventoryOnly: false });
  const filters = useMemo<UiFilters>(
    () => ({
      ...state,
      inventoryIds: state.inventoryOnly ? new Set(inventory.map((i) => i.species)) : undefined,
    }),
    [state, inventory],
  );
  return [filters, (f) => setState((s) => ({ ...s, ...f }))];
}

function FilterChips({ filters, set }: { filters: UiFilters; set: (f: Partial<UiFilters>) => void }) {
  return (
    <div className="filters">
      <label className="chk">
        <input type="checkbox" checked={filters.foodSafeOnly} onChange={(e) => set({ foodSafeOnly: e.target.checked })} />
        food-safe only
      </label>
      <label className="chk">
        <input type="checkbox" checked={filters.closedGrainOnly} onChange={(e) => set({ closedGrainOnly: e.target.checked })} />
        closed grain
      </label>
      <label className="chk">
        <input type="checkbox" checked={filters.accentMode} onChange={(e) => set({ accentMode: e.target.checked })} />
        accent mode (allow hard woods)
      </label>
      <label className="chk">
        <input type="checkbox" checked={filters.inventoryOnly} onChange={(e) => set({ inventoryOnly: e.target.checked })} />
        my inventory only
      </label>
      <div className="janka-row">
        <span>Janka {filters.jankaMin}–{filters.accentMode ? '3600' : filters.jankaMax}</span>
        <input
          type="range"
          min={300}
          max={2000}
          step={50}
          value={filters.jankaMin}
          onChange={(e) => set({ jankaMin: Number(e.target.value) })}
        />
        <input
          type="range"
          min={800}
          max={3600}
          step={50}
          value={filters.jankaMax}
          disabled={filters.accentMode}
          onChange={(e) => set({ jankaMax: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}

function SpeciesRow({ id, badge, onPick }: { id: string; badge?: string; onPick: (id: string) => void }) {
  const s = SPECIES_BY_ID.get(id)!;
  return (
    <button className="species-row" onClick={() => onPick(id)} title={s.botanical}>
      <span className="species-swatch" style={{ background: s.displayHex }} />
      <span className="species-meta">
        <b>{s.commonName}</b>
        <small>
          Janka {s.janka_lbf} · {s.porosity} grain · ${s.avgPricePerBF_usd}/bf
          {s.cautions.length > 0 && <span className="species-caution"> · ⚠ {s.cautions[0]}</span>}
        </small>
      </span>
      {badge && <span className={`badge badge-${badge.split(' ')[0]}`}>{badge}</span>}
    </button>
  );
}

function usePickSpecies() {
  const selection = useStore((s) => s.selection);
  const updateBoard = useStore((s) => s.updateBoard);
  return (id: string) => {
    if (!selection) return false;
    updateBoard((d) => {
      const strip = d.construction.layers[selection.group]?.strips[selection.strip];
      if (strip) strip.species = id;
    });
    return true;
  };
}

function BrowseTab() {
  const [filters, set] = useFilters();
  const [query, setQuery] = useState('');
  const selection = useStore((s) => s.selection);
  const pick = usePickSpecies();
  const board = useStore((s) => s.board);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recommendSpecies({ L: 0, a: 0, b: 0 }, CANDIDATES, filters)
      .map((r) => r.id)
      .filter((id) => {
        if (!q) return true;
        const s = SPECIES_BY_ID.get(id)!;
        return s.commonName.toLowerCase().includes(q) || s.botanical.toLowerCase().includes(q);
      })
      .sort((a, b) => SPECIES_BY_ID.get(a)!.commonName.localeCompare(SPECIES_BY_ID.get(b)!.commonName));
  }, [filters, query]);

  const current = useMemo(() => {
    const strips = expandLayers(board.construction.layers);
    return [...new Set(strips.map((s) => s.species))];
  }, [board]);

  const companions = useMemo(() => {
    const labs: Lab[] = current.map((id) => SPECIES_BY_ID.get(id)!.colorLab);
    return {
      contrast: suggestCompanions(labs, CANDIDATES, filters, 'contrast', new Set(current)).slice(0, 4),
      tone: suggestCompanions(labs, CANDIDATES, filters, 'tone', new Set(current)).slice(0, 4),
    };
  }, [current, filters]);

  return (
    <>
      <FilterChips filters={filters} set={set} />
      <input className="search" placeholder="Search species…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {!selection && <p className="hint">Click a strip swatch on the left, then pick a species here.</p>}
      {selection && <p className="hint">Replacing species on the selected strip.</p>}
      <div className="species-list">
        {list.map((id) => (
          <SpeciesRow key={id} id={id} onPick={pick} />
        ))}
        {list.length === 0 && <p className="hint">No species pass these filters — loosen them above.</p>}
      </div>
      <h4>Companion suggestions</h4>
      <p className="hint">Based on the {current.length} species already in this board.</p>
      <div className="companions">
        <div>
          <small>High contrast</small>
          {companions.contrast.map((c) => (
            <SpeciesRow key={c.id} id={c.id} badge={`ΔE ${c.minDeltaE.toFixed(0)}`} onPick={pick} />
          ))}
        </div>
        <div>
          <small>Tone-on-tone</small>
          {companions.tone.length === 0 && <p className="hint">None in range with these filters.</p>}
          {companions.tone.map((c) => (
            <SpeciesRow key={c.id} id={c.id} badge={`ΔE ${c.minDeltaE.toFixed(0)}`} onPick={pick} />
          ))}
        </div>
      </div>
    </>
  );
}

function MatchTab() {
  const [filters, set] = useFilters();
  const [hex, setHex] = useState('#8B5A2B');
  const pick = usePickSpecies();
  const selection = useStore((s) => s.selection);

  const ranked = useMemo(() => {
    const target = hexToLab(hex);
    return recommendSpecies(target, CANDIDATES, filters).slice(0, 12);
  }, [hex, filters]);

  return (
    <>
      <div className="color-pick">
        <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} />
        <input className="hex-input" value={hex} onChange={(e) => setHex(e.target.value)} spellCheck={false} />
        <ImageEyedropper onPick={setHex} />
      </div>
      <FilterChips filters={filters} set={set} />
      {!selection && <p className="hint">Click a strip swatch on the left to apply a match.</p>}
      <div className="species-list">
        {ranked.map((r) => (
          <SpeciesRow key={r.id} id={r.id} badge={`${matchBadge(r.deltaE)} ΔE ${r.deltaE.toFixed(1)}`} onPick={pick} />
        ))}
        {ranked.length === 0 && <p className="hint">No species pass these filters — loosen them above.</p>}
      </div>
      <p className="hint">
        ΔE2000 against each species' representative tone. Wood varies board to board — treat these as a starting point and
        check the real lumber in daylight. Excellent &lt; 5 · good &lt; 10 · fair &lt; 20.
      </p>
    </>
  );
}

/** Average the color over a dragged region of a loaded image — deterministic math. */
function ImageEyedropper({ onPick }: { onPick: (hex: string) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const sample = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const rect = img.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - rect.left) / rect.width) * img.naturalWidth);
    const cy = Math.floor(((e.clientY - rect.top) / rect.height) * img.naturalHeight);
    const r = Math.max(3, Math.floor(Math.min(img.naturalWidth, img.naturalHeight) * 0.03));
    const x0 = Math.max(0, cx - r);
    const y0 = Math.max(0, cy - r);
    const w = Math.min(img.naturalWidth - x0, r * 2);
    const h = Math.min(img.naturalHeight - y0, r * 2);
    const data = ctx.getImageData(x0, y0, w, h).data;
    let R = 0;
    let G = 0;
    let B = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      R += data[i];
      G += data[i + 1];
      B += data[i + 2];
      n++;
    }
    const p = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    onPick(`#${p(R)}${p(G)}${p(B)}`);
    setNote(`sampled ${n} px`);
  };

  return (
    <div className="eyedropper">
      <label className="file-btn">
        Sample an image
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) setSrc(URL.createObjectURL(file));
          }}
        />
      </label>
      {src && (
        <>
          <img src={src} alt="click to sample a color" onClick={sample} />
          <small>{note || 'Click anywhere on the image to average that region.'}</small>
        </>
      )}
    </div>
  );
}
