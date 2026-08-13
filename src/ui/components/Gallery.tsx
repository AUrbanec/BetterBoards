import { useMemo } from 'react';
import { runPipeline } from '../../engine/construction/pipeline';
import { TEMPLATES } from '../../engine/patterns/templates';
import { renderBoardSvg } from '../../exports/boardSvg';
import { SPECIES_BY_ID } from '../../data/species';
import { speciesLetters } from '../../exports/shared';
import { listSavedProjects, useStore } from '../../store/store';

export function Gallery() {
  const open = useStore((s) => s.galleryOpen);
  const setOpen = useStore((s) => s.setGalleryOpen);
  const newFromTemplate = useStore((s) => s.newFromTemplate);
  const loadSaved = useStore((s) => s.loadSaved);
  const deleteSaved = useStore((s) => s.deleteSaved);
  const loadProjectText = useStore((s) => s.loadProjectText);
  const saved = useMemo(() => (open ? listSavedProjects() : []), [open]);

  const thumbs = useMemo(
    () =>
      open
        ? TEMPLATES.map((t) => {
            const board = t.build();
            const result = runPipeline(board);
            const letters = speciesLetters(board);
            const svg = result.ok
              ? renderBoardSvg(result.grid, (id) => {
                  const s = SPECIES_BY_ID.get(id)!;
                  return { hex: s.displayHex, tint: s.textureTint, letter: letters.get(id) ?? '?', name: s.commonName };
                }, { pxPerIn: 12, idPrefix: `t-${t.id}` })
              : '';
            return { t, svg };
          })
        : [],
    [open],
  );

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal gallery" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Start a board</h2>
          <button onClick={() => setOpen(false)}>✕</button>
        </div>
        <p className="hint">Templates are presets, not modes — everything stays editable afterwards.</p>
        <div className="gallery-grid">
          {thumbs.map(({ t, svg }) => (
            <button key={t.id} className="gallery-card" onClick={() => newFromTemplate(t.id)}>
              <div className="gallery-thumb" dangerouslySetInnerHTML={{ __html: svg }} />
              <b>{t.name}</b>
              <small>{t.description}</small>
            </button>
          ))}
        </div>

        <div className="gallery-open">
          <label className="file-btn">
            Open a .cbproj file…
            <input
              type="file"
              accept=".cbproj,application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const err = loadProjectText(await file.text());
                if (err) alert(err);
              }}
            />
          </label>
        </div>

        {saved.length > 0 && (
          <>
            <h3>Saved on this computer</h3>
            <ul className="saved-list">
              {saved.map((p) => (
                <li key={p.id}>
                  <button className="saved-open" onClick={() => loadSaved(p.id)}>
                    <b>{p.name}</b>
                    <small>{new Date(p.savedAt).toLocaleString()}</small>
                  </button>
                  <button
                    title="Delete"
                    onClick={() => {
                      if (confirm(`Delete "${p.name}" from this browser? The file on disk (if you exported one) is untouched.`)) {
                        deleteSaved(p.id);
                        setOpen(false);
                        setTimeout(() => setOpen(true), 0);
                      }
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
