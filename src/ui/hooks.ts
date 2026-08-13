import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useStore } from '../store/store';
import { runPipeline } from '../engine/construction/pipeline';
import { buildCutList } from '../engine/cutlist/cutlist';
import { validateBoard, type SpeciesMeta } from '../engine/validate/rules';
import { makeSpeciesInfoLookup, SPECIES_BY_ID } from '../data/species';
import { speciesLetters } from '../exports/shared';
import type { SpeciesVisualLookup } from '../exports/boardSvg';

export const speciesMetaLookup = (id: string): SpeciesMeta | undefined => {
  const s = SPECIES_BY_ID.get(id);
  if (!s) return undefined;
  return {
    id: s.id,
    commonName: s.commonName,
    janka_lbf: s.janka_lbf,
    foodSafe: s.foodSafe,
    porosity: s.porosity,
    cautions: s.cautions,
    movement: s.movement,
  };
};

/** All engine-derived data for the current board, memoized. */
export function useDerived() {
  const board = useStore((s) => s.board);
  const inventory = useStore((s) => s.inventory);
  return useMemo(() => {
    const overrides: Record<string, number> = {};
    for (const item of inventory) {
      if (item.pricePerBF !== undefined) overrides[item.species] = item.pricePerBF;
    }
    const info = makeSpeciesInfoLookup(overrides);
    const result = runPipeline(board);
    const cutlist = buildCutList(board, result, info);
    const lints = validateBoard(board, result, speciesMetaLookup, cutlist);
    return { result, cutlist, lints, info };
  }, [board, inventory]);
}

/** Species → swatch/letter/name lookup for the current board. */
export function useSpeciesVisual(): SpeciesVisualLookup {
  const board = useStore((s) => s.board);
  return useMemo(() => {
    const letters = speciesLetters(board);
    return (id: string) => {
      const s = SPECIES_BY_ID.get(id);
      return {
        hex: s?.displayHex ?? '#c9b18c',
        tint: s?.textureTint ?? ['#d8c4a2', '#b09774'],
        letter: letters.get(id) ?? '?',
        name: s?.commonName ?? id,
      };
    };
  }, [board]);
}

/** Observed content width of a container element. */
export function useContainerWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(200, e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Trigger a client-side file download. */
export function download(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Open a print window with prepared page divs (user prints to PDF). */
export function printPages(title: string, pagesHtml: string, extraCss = ''): void {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) {
    alert('Your browser blocked the print window — allow pop-ups for this page.');
    return;
  }
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>` +
      `@page { size: letter; margin: 0; }` +
      `body { margin: 0; background: #777; }` +
      `.page { background: white; margin: 8px auto; box-shadow: 0 1px 6px rgba(0,0,0,.4); width: 816px; height: 1056px; overflow: hidden; }` +
      `@media print { body { background: white; } .page { margin: 0; box-shadow: none; page-break-after: always; } }` +
      extraCss +
      `</style></head><body>${pagesHtml}</body></html>`,
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}
