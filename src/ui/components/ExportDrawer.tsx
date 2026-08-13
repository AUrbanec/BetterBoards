import { useState } from 'react';
import type { CutList } from '../../engine/cutlist/cutlist';
import type { Lint } from '../../engine/validate/rules';
import type { PipelineResult } from '../../engine/construction/types';
import { renderBlueprint, type PageSize } from '../../exports/blueprint';
import { renderBoardSvg } from '../../exports/boardSvg';
import { cutListToCsv } from '../../exports/csv';
import { generateInstructions, instructionsToMarkdown } from '../../exports/instructions';
import { generateToolpaths } from '../../engine/cnc/toolpath';
import { emitAllGcode } from '../../engine/cnc/gcode';
import { toolpathsToDxf, toolpathsToSvg } from '../../engine/cnc/dxf';
import { defaultCncOptions } from '../../engine/cnc/types';
import { useStore } from '../../store/store';
import { download, printPages, useSpeciesVisual } from '../hooks';

interface Props {
  result: PipelineResult;
  cutlist: CutList;
  lints: Lint[];
  info: (id: string) => { name: string; pricePerBF?: number } | undefined;
}

export function ExportDrawer({ result, cutlist, lints, info }: Props) {
  const open = useStore((s) => s.exportOpen);
  const setOpen = useStore((s) => s.setExportOpen);
  const board = useStore((s) => s.board);
  const name = useStore((s) => s.name);
  const units = useStore((s) => s.units);
  const serializeCurrent = useStore((s) => s.serializeCurrent);
  const visual = useSpeciesVisual();
  const [pageSize, setPageSize] = useState<PageSize>('letter');

  if (!open) return null;

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
  const blocked = !result.ok;
  const cncOptions = board.cnc ?? defaultCncOptions(result.finished.thickness);
  const cncOps = generateToolpaths(result.outline, cncOptions);
  const cncBlocked = blocked || cncOps.errors.length > 0;

  const blueprint = () => renderBlueprint(board, result, cutlist, lints, visual, info, units, pageSize);

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal export" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Export</h2>
          <button onClick={() => setOpen(false)}>✕</button>
        </div>

        {blocked && <p className="lint-err">✖ Fix the design errors before exporting — the geometry is not buildable.</p>}

        <div className="row">
          <span>Page size</span>
          <select value={pageSize} onChange={(e) => setPageSize(e.target.value as PageSize)}>
            <option value="letter">US Letter</option>
            <option value="a4">A4</option>
          </select>
        </div>

        <div className="export-grid">
          <button
            disabled={blocked}
            onClick={() => {
              const pages = blueprint();
              printPages(
                `${name} — blueprint`,
                pages.map((p) => `<div class="page">${p}</div>`).join(''),
              );
            }}
          >
            <b>Blueprint → print / PDF</b>
            <small>Dimensioned drawings, glue-up diagrams, cut list. Print at 100% (no "fit to page") to keep the stated scale.</small>
          </button>

          <button
            disabled={blocked}
            onClick={() => {
              const pages = blueprint();
              pages.forEach((p, i) => download(`${slug}-blueprint-p${i + 1}.svg`, 'image/svg+xml', p));
            }}
          >
            <b>Blueprint → SVG pages</b>
            <small>Vector files, one per page.</small>
          </button>

          <button
            disabled={blocked}
            onClick={() => download(`${slug}-cutlist.csv`, 'text/csv', cutListToCsv(board, result, cutlist, info))}
          >
            <b>Cut list → CSV</b>
            <small>Excel-friendly; fractions stay text.</small>
          </button>

          <button
            disabled={blocked}
            onClick={() => {
              const md = instructionsToMarkdown(generateInstructions(board, result, cutlist, info, units));
              download(`${slug}-instructions.md`, 'text/markdown', md);
            }}
          >
            <b>Instructions → Markdown</b>
            <small>Numbered build steps with your dimensions.</small>
          </button>

          <button
            disabled={blocked}
            onClick={() => {
              const svg = renderBoardSvg(result.grid, visual, { pxPerIn: 96, showLabels: false, idPrefix: 'ex', outline: result.outline });
              download(`${slug}.svg`, 'image/svg+xml', svg);
            }}
          >
            <b>Board → SVG</b>
            <small>The top view alone, at full scale.</small>
          </button>

          <button onClick={() => download(`${slug}.cbproj`, 'application/json', serializeCurrent())}>
            <b>Project → .cbproj</b>
            <small>Save the design to a file you own.</small>
          </button>
        </div>

        <h3>CNC</h3>
        {cncOps.operations.length === 0 ? (
          <p className="hint">No CNC operations are enabled — turn them on in the CNC panel to export toolpaths.</p>
        ) : (
          <>
            {cncBlocked && (
              <p className="lint-err">
                ✖ CNC export is blocked until these are fixed:
                {cncOps.errors.map((e, i) => (
                  <span key={i}> {e}</span>
                ))}
              </p>
            )}
            <div className="export-grid">
              <button
                disabled={cncBlocked}
                onClick={() => {
                  const { files, violations } = emitAllGcode(cncOps.operations, cncOptions);
                  if (violations.length) {
                    alert(`Refusing to export — the emitter found safety violations:\n\n${violations.join('\n')}`);
                    return;
                  }
                  for (const f of files) download(`${slug}-${f.name}`, 'text/plain', f.text);
                }}
              >
                <b>G-code → .nc</b>
                <small>One file per operation plus a combined file with tool-change stops. Preview first.</small>
              </button>
              <button
                disabled={cncBlocked}
                onClick={() => download(`${slug}-toolpaths.dxf`, 'application/dxf', toolpathsToDxf(result.outline, cncOps.operations))}
              >
                <b>Toolpaths → DXF</b>
                <small>R12, one layer per operation, for your own CAM.</small>
              </button>
              <button
                disabled={cncBlocked}
                onClick={() => download(`${slug}-toolpaths.svg`, 'image/svg+xml', toolpathsToSvg(result.outline, cncOps.operations))}
              >
                <b>Toolpaths → SVG</b>
                <small>Flat vector paths for VCarve/Carbide Create.</small>
              </button>
            </div>
            <p className="hint">
              Feeds and speeds are starting points, not recommendations. Air-cut every new program with Z raised before
              you put wood on the table.
            </p>
          </>
        )}

        <p className="hint">
          Everything is generated in your browser — nothing is uploaded anywhere. The blueprint's printed scale is only
          accurate when your print dialog is set to 100% / actual size.
        </p>
      </div>
    </div>
  );
}
