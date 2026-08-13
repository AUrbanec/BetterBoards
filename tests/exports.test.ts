import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/engine/construction/pipeline';
import { buildCutList } from '../src/engine/cutlist/cutlist';
import { generateInstructions, instructionsToMarkdown } from '../src/exports/instructions';
import { cutListToCsv } from '../src/exports/csv';
import { renderBlueprint } from '../src/exports/blueprint';
import { renderBoardSvg } from '../src/exports/boardSvg';
import { parseProject, serializeProject } from '../src/exports/project';
import { TEMPLATE_BY_ID, TEMPLATES } from '../src/engine/patterns/templates';
import { isPlainRect } from '../src/engine/geometry/outline';
import { makeSpeciesInfoLookup, SPECIES_BY_ID } from '../src/data/species';
import { speciesLetters } from '../src/exports/shared';
import type { SpeciesVisualLookup } from '../src/exports/boardSvg';

const info = makeSpeciesInfoLookup();

function visualFor(boardId: string): SpeciesVisualLookup {
  const board = TEMPLATE_BY_ID.get(boardId)!.build();
  const letters = speciesLetters(board);
  return (id) => {
    const s = SPECIES_BY_ID.get(id)!;
    return { hex: s.displayHex, tint: s.textureTint, letter: letters.get(id) ?? '?', name: s.commonName };
  };
}

describe('instructions generator', () => {
  it('emits deterministic numbered steps for the checkerboard', () => {
    const board = TEMPLATE_BY_ID.get('checkerboard')!.build();
    const result = runPipeline(board);
    const cl = buildCutList(board, result, info);
    const ins = generateInstructions(board, result, cl, info);
    const md = instructionsToMarkdown(ins);
    expect(ins.steps.map((s) => s.title)).toEqual([
      'Gather and mill stock',
      'Rip the strips',
      'Glue-up #1 — the slab',
      'Flatten the slab',
      'Crosscut into slices',
      'Arrange the slices',
      'Glue-up #2 — the board',
      'Flatten the board',
      'Trim to final size',
      'Ease, sand, finish',
    ]);
    expect(md).toContain('Rotate slices 2, 4, 6, 8, 10, 12 end-for-end');
    expect(md).toContain('NEVER feed an end-grain board through a thickness planer');
    expect(md).toContain('12 slices, each 1 3/8"');
    // generating twice gives identical output (deterministic)
    expect(instructionsToMarkdown(generateInstructions(board, result, cl, info))).toBe(md);
  });

  it('emits miter-gauge and flip steps for the chevron', () => {
    const board = TEMPLATE_BY_ID.get('chevron')!.build();
    const result = runPipeline(board);
    expect(result.ok).toBe(true);
    const cl = buildCutList(board, result, info);
    const md = instructionsToMarkdown(generateInstructions(board, result, cl, info));
    expect(md).toContain('miter gauge to 45°');
    expect(md).toContain('Flip slices');
    expect(md).toContain('parallelogram slices');
  });
});

describe('csv export', () => {
  it('quotes fractions as Excel text and includes every section', () => {
    const board = TEMPLATE_BY_ID.get('checkerboard')!.build();
    const result = runPipeline(board);
    const cl = buildCutList(board, result, info);
    const csv = cutListToCsv(board, result, cl, info);
    expect(csv).toContain('RIP SCHEDULE');
    expect(csv).toContain('MATERIALS BY SPECIES');
    expect(csv).toContain('CROSSCUT SCHEDULE');
    expect(csv).toContain('ALLOWANCES');
    expect(csv).toContain('"=""1 1/2"""'); // 1.5″ strip width as text formula
    expect(csv.split('\r\n').length).toBeGreaterThan(20);
  });
});

describe('blueprint', () => {
  it('renders well-formed SVG pages for every template', () => {
    for (const t of TEMPLATES) {
      const board = t.build();
      const result = runPipeline(board);
      expect(result.ok, t.id).toBe(true);
      const cl = buildCutList(board, result, info);
      const pages = renderBlueprint(board, result, cl, [], visualFor(t.id), info, 'in-frac');
      // board + glue-up, then a crosscut page for end grain and a shaping page
      // for anything that isn't a plain rectangle, then the cut list
      const expectedPages = 3 + (result.crosscut ? 1 : 0) + (isPlainRect(result.outline) ? 0 : 1);
      expect(pages.length, t.id).toBe(expectedPages);
      for (const p of pages) {
        expect(p.startsWith('<svg')).toBe(true);
        expect(p.endsWith('</svg>')).toBe(true);
        // balanced tags (cheap sanity)
        expect((p.match(/<svg/g) ?? []).length).toBe(1);
        expect(p).not.toContain('NaN');
        expect(p).not.toContain('undefined');
      }
    }
  });

  it('board svg renders one path pair per cell', () => {
    const board = TEMPLATE_BY_ID.get('checkerboard')!.build();
    const result = runPipeline(board);
    const svg = renderBoardSvg(result.grid, visualFor('checkerboard'), { pxPerIn: 20 });
    const cellCount = result.grid.rows.reduce((t, r) => t + r.cells.length, 0);
    expect(cellCount).toBe(12 * 8);
    expect((svg.match(/<path d="M/g) ?? []).length).toBeGreaterThanOrEqual(cellCount * 2);
    expect(svg).not.toContain('NaN');
  });
});

describe('project round-trip', () => {
  it('serialize → parse preserves the board exactly', () => {
    const board = TEMPLATE_BY_ID.get('herringbone')!.build();
    const json = serializeProject({
      id: 'p1',
      name: 'Test',
      board,
      inventory: [{ species: 'hard-maple', boardFeet: 10 }],
      ui: { units: 'in-frac' },
    });
    const parsed = parseProject(json);
    expect(parsed.board).toEqual(board);
    expect(parsed.inventory.length).toBe(1);
    expect(parsed.formatVersion).toBe(1);
  });

  it('rejects foreign files with a clear error', () => {
    expect(() => parseProject('{"foo": 1}')).toThrow(/not a betterboards/i);
    expect(() => parseProject('meow')).toThrow(/json/i);
    expect(() =>
      parseProject(JSON.stringify({ kind: 'betterboards-project', formatVersion: 99 })),
    ).toThrow(/newer/i);
  });
});
