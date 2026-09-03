import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createReliefPlan, reliefGridCsv, sampleReliefGrid, type ReliefPlan, type ReliefSettings } from '../../engine/relief/relief';

interface Props { open: boolean; onClose: () => void }

const download = (name: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};

export function PhotoRelief({ open, onClose }: Props) {
  const [source, setSource] = useState<ImageData | null>(null);
  const [fileName, setFileName] = useState('photo');
  const [settings, setSettings] = useState<ReliefSettings>({ maxDepthMm: 6, levels: 7, blurRadius: 1, contrast: 1.2, invert: false });
  const [size, setSize] = useState({ width: 250, height: 180, thickness: 19 });
  const [gridSize, setGridSize] = useState({ columns: 12, rows: 8 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const plan = useMemo(() => source ? createReliefPlan(source.data, source.width, source.height, settings) : null, [source, settings]);
  const grid = useMemo(() => plan ? sampleReliefGrid(plan, gridSize.columns, gridSize.rows) : [], [plan, gridSize]);

  useEffect(() => {
    if (!plan || !canvas.current) return;
    const ctx = canvas.current.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(plan.width, plan.height);
    for (let i = 0; i < plan.depths.length; i++) {
      const shade = Math.round(246 - (plan.depths[i] / settings.maxDepthMm) * 190);
      image.data.set([shade, Math.round(shade * .91), Math.round(shade * .78), 255], i * 4);
    }
    ctx.putImageData(image, 0, 0);
  }, [plan, settings.maxDepthMm]);

  if (!open) return null;
  const update = <K extends keyof ReliefSettings>(key: K, value: ReliefSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const loadImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setFileName(file.name.replace(/\.[^.]+$/, '') || 'photo');
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 640 / img.width, 480 / img.height);
      const width = Math.max(1, Math.round(img.width * scale)); const height = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas'); c.width = width; c.height = height;
      const context = c.getContext('2d', { willReadFrequently: true }); context?.drawImage(img, 0, 0, width, height);
      if (context) setSource(context.getImageData(0, 0, width, height));
      setSize((s) => ({ ...s, height: Math.round(s.width * height / width) })); URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return <div className="modal-backdrop relief-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="modal relief-modal" role="dialog" aria-modal="true" aria-label="Photo relief planner">
      <div className="modal-head"><div><h2>Photo → relief carving plan</h2><p className="hint">Build a measurable, stepped depth map for hand carving with rotary tools and calipers.</p></div><button onClick={onClose} aria-label="Close">✕</button></div>
      {!source ? <label className="relief-drop">
        <span className="relief-drop-icon">▧</span><strong>Choose a landscape or cityscape photo</strong><span>JPEG, PNG, or WebP · processed privately in your browser</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={loadImage} />
      </label> : <div className="relief-layout">
        <div className="relief-preview">
          <canvas ref={canvas} width={plan?.width} height={plan?.height} />
          <div className="relief-legend"><span>Surface · 0 mm</span><i /><span>Deep · {settings.maxDepthMm.toFixed(1)} mm</span></div>
          <label className="file-btn">Replace photo<input type="file" accept="image/*" onChange={loadImage} /></label>
        </div>
        <div className="relief-controls">
          <h3>Workpiece</h3>
          <div className="relief-fields"><label>Width (mm)<input type="number" min="20" value={size.width} onChange={(e) => setSize({ ...size, width: +e.target.value })} /></label><label>Height (mm)<input type="number" min="20" value={size.height} onChange={(e) => setSize({ ...size, height: +e.target.value })} /></label><label>Stock (mm)<input type="number" min="5" value={size.thickness} onChange={(e) => setSize({ ...size, thickness: +e.target.value })} /></label></div>
          <h3>Depth mapping</h3>
          <label className="relief-slider"><span>Maximum removal <b>{settings.maxDepthMm.toFixed(1)} mm</b></span><input type="range" min="1" max={Math.max(1, size.thickness - 4)} step="0.5" value={settings.maxDepthMm} onChange={(e) => update('maxDepthMm', +e.target.value)} /></label>
          <label className="relief-slider"><span>Depth levels <b>{settings.levels}</b></span><input type="range" min="3" max="16" value={settings.levels} onChange={(e) => update('levels', +e.target.value)} /></label>
          <label className="relief-slider"><span>Edge smoothing <b>{settings.blurRadius}px</b></span><input type="range" min="0" max="5" value={settings.blurRadius} onChange={(e) => update('blurRadius', +e.target.value)} /></label>
          <label className="relief-slider"><span>Contrast <b>{settings.contrast.toFixed(1)}×</b></span><input type="range" min="0.5" max="2.5" step="0.1" value={settings.contrast} onChange={(e) => update('contrast', +e.target.value)} /></label>
          <label className="chk"><input type="checkbox" checked={settings.invert} onChange={(e) => update('invert', e.target.checked)} /> Invert depth (light areas cut deepest)</label>
        </div>
        <div className="relief-plan">
          <div className="relief-plan-head"><div><h3>Caliper checkpoint map</h3><p className="hint">Numbers are removal depth in millimeters, measured down from the original face.</p></div><div><select value={gridSize.columns} onChange={(e) => setGridSize({ ...gridSize, columns: +e.target.value })}><option value="8">8 columns</option><option value="12">12 columns</option><option value="16">16 columns</option></select><select value={gridSize.rows} onChange={(e) => setGridSize({ ...gridSize, rows: +e.target.value })}><option value="6">6 rows</option><option value="8">8 rows</option><option value="12">12 rows</option></select></div></div>
          <div className="depth-grid" style={{ gridTemplateColumns: `repeat(${gridSize.columns}, 1fr)` }}>{grid.flatMap((row, y) => row.map((depth, x) => <span key={`${x}-${y}`} title={`Column ${x + 1}, row ${y + 1}: ${depth.toFixed(2)} mm`} style={{ background: `rgba(91,55,25,${.06 + depth / settings.maxDepthMm * .68})` }}>{depth.toFixed(1)}</span>))}</div>
          <div className="relief-summary"><div><b>{settings.levels}</b><span>depth terraces</span></div><div><b>{(settings.maxDepthMm / (settings.levels - 1)).toFixed(2)} mm</b><span>between levels</span></div><div><b>{(size.thickness - settings.maxDepthMm).toFixed(1)} mm</b><span>minimum backing</span></div><div><b>{plan?.removedPercent.toFixed(0)}%</b><span>mean removal</span></div></div>
          <h3>Recommended carving sequence</h3>
          <ol className="relief-steps"><li><b>Transfer the grid.</b> Mark {gridSize.columns} × {gridSize.rows} cells, each {(size.width / (gridSize.columns - 1)).toFixed(1)} × {(size.height / (gridSize.rows - 1)).toFixed(1)} mm between checkpoints.</li><li><b>Rough the background.</b> Use a 6–8 mm ball or cylinder burr; stop 0.5 mm above each printed depth.</li><li><b>Shape transitions.</b> Use a 3 mm ball-nose bit, working shallow-to-deep and preserving silhouette ridges.</li><li><b>Verify often.</b> Bridge adjacent high points with a straightedge and use the caliper depth rod. Never exceed {settings.maxDepthMm.toFixed(1)} mm.</li><li><b>Finish.</b> Refine with 1–2 mm ball/diamond bits, then sand with a flexible abrasive without rounding the highest contours.</li></ol>
          {settings.maxDepthMm > size.thickness * .5 && <p className="relief-warning">⚠ Maximum removal exceeds half the stock thickness. Use thicker stock or reduce depth to limit weakening and breakthrough.</p>}
          <div className="relief-actions"><button onClick={() => download(`${fileName}-depth-grid.csv`, reliefGridCsv(plan!, gridSize.columns, gridSize.rows), 'text/csv')}>Download depth grid CSV</button><button className="primary" onClick={() => window.print()}>Print carving plan</button></div>
        </div>
      </div>}
      <p className="relief-note"><b>Important:</b> A single photo contains tone, not true distance. This plan maps brightness to carving depth; review the preview and invert it when needed. Test on scrap, clamp the work securely, and wear eye and respiratory protection.</p>
    </section>
  </div>;
}
