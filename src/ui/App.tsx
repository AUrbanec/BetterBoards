import { useEffect, useState } from 'react';
import type { UnitMode } from '../engine/units';
import { useStore } from '../store/store';
import { useDerived } from './hooks';
import { Canvas } from './components/Canvas';
import { CncPanel } from './components/CncPanel';
import { CutListView } from './components/CutListView';
import { ExportDrawer } from './components/ExportDrawer';
import { Gallery } from './components/Gallery';
import { InstructionsView } from './components/InstructionsView';
import { LayerPanel } from './components/LayerPanel';
import { SpeciesPanel } from './components/SpeciesPanel';
import { TotalsBar } from './components/TotalsBar';

type RightTab = 'species' | 'cutlist' | 'steps' | 'cnc';

export function App() {
  const { result, cutlist, lints, info } = useDerived();
  const name = useStore((s) => s.name);
  const setName = useStore((s) => s.setName);
  const units = useStore((s) => s.units);
  const setUnits = useStore((s) => s.setUnits);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const setGalleryOpen = useStore((s) => s.setGalleryOpen);
  const setExportOpen = useStore((s) => s.setExportOpen);
  const [tab, setTab] = useState<RightTab>('species');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">BetterBoards</span>
        <input className="project-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
        <div className="topbar-tools">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
          <select value={units} onChange={(e) => setUnits(e.target.value as UnitMode)} aria-label="Units">
            <option value="in-frac">in (fractions)</option>
            <option value="in-dec">in (decimal)</option>
            <option value="mm">mm</option>
          </select>
          <button onClick={() => setGalleryOpen(true)}>Templates</button>
          <button className="primary" onClick={() => setExportOpen(true)}>Export</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left"><LayerPanel /></aside>
        <section className="center"><Canvas result={result} /></section>
        <aside className="right">
          <div className="row seg right-tabs">
            <button className={tab === 'species' ? 'seg-on' : ''} onClick={() => setTab('species')}>Species</button>
            <button className={tab === 'cutlist' ? 'seg-on' : ''} onClick={() => setTab('cutlist')}>Cut list</button>
            <button className={tab === 'steps' ? 'seg-on' : ''} onClick={() => setTab('steps')}>Steps</button>
            <button className={tab === 'cnc' ? 'seg-on' : ''} onClick={() => setTab('cnc')}>CNC</button>
          </div>
          <div className="right-body">
            {tab === 'species' && <SpeciesPanel />}
            {tab === 'cutlist' && <CutListView result={result} cutlist={cutlist} />}
            {tab === 'steps' && <InstructionsView result={result} cutlist={cutlist} info={info} />}
            {tab === 'cnc' && <CncPanel result={result} />}
          </div>
        </aside>
      </main>

      <TotalsBar result={result} cutlist={cutlist} lints={lints} />
      <Gallery />
      <ExportDrawer result={result} cutlist={cutlist} lints={lints} info={info} />
    </div>
  );
}
