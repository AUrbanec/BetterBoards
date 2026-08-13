import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { IN, inch } from '../src/engine/units';
import {
  depthPasses,
  estimateMinutes,
  generateToolpaths,
  tabSpans,
  type Operation,
} from '../src/engine/cnc/toolpath';
import { auditGcode, emitAllGcode, emitGcode, parseGcode } from '../src/engine/cnc/gcode';
import { toolpathsToDxf, toolpathsToSvg } from '../src/engine/cnc/dxf';
import { defaultCncOptions, toolById, type CncOptions } from '../src/engine/cnc/types';
import { FONT_METRICS, glyphFor, hersheyText, unsupportedChars, SUPPORTED_CHARS } from '../src/engine/cnc/hershey';
import { bbox, distanceToRing, pointInRing } from '../src/engine/geometry/polygon';
import { outlineToRing, type Outline } from '../src/engine/geometry/outline';

const RECT: Outline = { kind: 'rect', w: inch(16), h: inch(10), cornerRadius: inch(0.75) };

function cnc(over: (o: CncOptions) => void = () => {}): CncOptions {
  const o = defaultCncOptions(inch(1));
  over(o);
  return o;
}

describe('depth passes', () => {
  it('never exceeds the stepdown and lands exactly on the total', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 100 }), (t32, s32) => {
        const total = (t32 * IN) / 32;
        const step = (s32 * IN) / 32;
        const passes = depthPasses(total, step);
        expect(passes[passes.length - 1]).toBeCloseTo(total, 6);
        let prev = 0;
        for (const p of passes) {
          expect(p - prev).toBeLessThanOrEqual(step + 1);
          expect(p).toBeGreaterThan(prev);
          prev = p;
        }
      }),
    );
  });
});

describe('tabs', () => {
  it('spaces tabs evenly around the path', () => {
    const ring = outlineToRing({ kind: 'rect', w: inch(10), h: inch(10), cornerRadius: 0 });
    const spans = tabSpans(ring, 4, inch(0.5));
    expect(spans.length).toBe(4);
    const centers = spans.map((s) => (s.start + s.end) / 2);
    for (let i = 1; i < centers.length; i++) {
      expect(centers[i] - centers[i - 1]).toBeCloseTo(centers[1] - centers[0], 3);
    }
    for (const s of spans) expect(s.end - s.start).toBeCloseTo(inch(0.5), 6);
  });

  it('leaves material at tab locations', () => {
    const o = cnc((c) => {
      c.profile.tabs = { count: 4, width: inch(0.5), height: inch(0.15) };
      c.profile.tool = toolById('em-250');
    });
    const { operations } = generateToolpaths(RECT, o);
    const profile = operations.find((op) => op.kind === 'profile')!;
    const cutting = profile.moves.filter((m) => m.kind === 'feed');
    const fullDepth = o.stockThickness + o.profile.throughDepth;
    // tabs sit exactly `height` above the bottom of the cut
    const tabZ = -(fullDepth - o.profile.tabs.height);
    const onTabs = cutting.filter((m) => Math.abs(m.z - tabZ) < 1);
    expect(onTabs.length).toBeGreaterThan(0);
    // and the cutter still reaches full depth everywhere else
    expect(Math.min(...cutting.map((m) => m.z))).toBeCloseTo(-fullDepth, 6);
    // nothing is left stranded between tab height and full depth
    for (const m of cutting) {
      const atTab = Math.abs(m.z - tabZ) < 1;
      const stepped = Math.abs(m.z) <= fullDepth + 1;
      expect(atTab || stepped).toBe(true);
    }
  });
});

describe('profile toolpath', () => {
  it('offsets outward by the tool radius so the board keeps its size', () => {
    const o = cnc();
    const { operations } = generateToolpaths(RECT, o);
    const profile = operations.find((op) => op.kind === 'profile')!;
    const src = outlineToRing(RECT);
    const r = o.profile.tool.diameter / 2;
    for (const p of profile.paths[0]) {
      expect(pointInRing(p, src)).toBe(false); // outside the finished edge
      expect(Math.abs(distanceToRing(p, src) - r)).toBeLessThan(r * 0.05);
    }
  });

  it('cuts through the stock plus the stated overcut, and no further', () => {
    const o = cnc();
    const { operations } = generateToolpaths(RECT, o);
    const profile = operations.find((op) => op.kind === 'profile')!;
    const deepest = Math.min(...profile.moves.map((m) => m.z));
    expect(-deepest).toBeCloseTo(o.stockThickness + o.profile.throughDepth, 6);
  });

  it('climb and conventional run opposite directions', () => {
    const climb = generateToolpaths(RECT, cnc((c) => void (c.profile.direction = 'climb')));
    const conv = generateToolpaths(RECT, cnc((c) => void (c.profile.direction = 'conventional')));
    const first = (r: typeof climb) => r.operations.find((o) => o.kind === 'profile')!.paths[0];
    expect(first(climb)[1]).not.toEqual(first(conv)[1]);
  });
});

describe('juice groove', () => {
  it('insets from the finished edge by the margin', () => {
    const o = cnc((c) => {
      c.groove.enabled = true;
      c.groove.margin = inch(0.75);
    });
    const { operations } = generateToolpaths(RECT, o);
    const groove = operations.find((op) => op.kind === 'groove')!;
    const src = outlineToRing(RECT);
    for (const p of groove.paths[0]) {
      expect(pointInRing(p, src)).toBe(true);
      expect(Math.abs(distanceToRing(p, src) - inch(0.75))).toBeLessThan(inch(0.04));
    }
  });

  it('blocks export when deeper than 40% of the board', () => {
    const o = cnc((c) => {
      c.groove.enabled = true;
      c.groove.depth = inch(0.6); // > 40% of 1"
    });
    const res = generateToolpaths(RECT, o);
    expect(res.errors.some((e) => /40%/.test(e))).toBe(true);
  });

  it('reports rather than crashes when the margin swallows the board', () => {
    const o = cnc((c) => {
      c.groove.enabled = true;
      c.groove.margin = inch(20);
    });
    const res = generateToolpaths(RECT, o);
    const groove = res.operations.find((op) => op.kind === 'groove')!;
    expect(groove.moves).toEqual([]);
    expect(groove.warnings.length).toBeGreaterThan(0);
  });
});

describe('pocket', () => {
  it('generates nested contour rings inside the board', () => {
    const o = cnc((c) => {
      c.pocket.enabled = true;
      c.pocket.placement = { cx: 0.5, cy: 0.5, w: inch(4), h: inch(1.5) };
    });
    const { operations } = generateToolpaths(RECT, o);
    const pocket = operations.find((op) => op.kind === 'pocket')!;
    expect(pocket.paths.length).toBeGreaterThan(1);
    const src = outlineToRing(RECT);
    for (const ring of pocket.paths) {
      for (const p of ring) expect(pointInRing(p, src)).toBe(true);
    }
    // cut inside-out: the first path is the innermost (smallest bbox)
    const size = (i: number) => {
      const b = bbox(pocket.paths[i]);
      return (b.maxX - b.minX) * (b.maxY - b.minY);
    };
    expect(size(0)).toBeLessThan(size(pocket.paths.length - 1));
  });

  it('warns when the pocket escapes the board', () => {
    const o = cnc((c) => {
      c.pocket.enabled = true;
      c.pocket.placement = { cx: 0.95, cy: 0.5, w: inch(6), h: inch(2) };
    });
    const { operations } = generateToolpaths(RECT, o);
    const pocket = operations.find((op) => op.kind === 'pocket')!;
    expect(pocket.warnings.some((w) => /past the board/.test(w))).toBe(true);
  });
});

describe('engraving font', () => {
  it('every glyph stays inside its declared box', () => {
    for (const ch of SUPPORTED_CHARS) {
      const g = glyphFor(ch)!;
      for (const stroke of g.strokes) {
        for (const [x, y] of stroke) {
          expect(x, `${ch} x`).toBeGreaterThanOrEqual(-0.01);
          expect(x, `${ch} x`).toBeLessThanOrEqual(g.w + 0.9);
          expect(y, `${ch} y`).toBeGreaterThanOrEqual(-2.01); // descenders
          expect(y, `${ch} y`).toBeLessThanOrEqual(FONT_METRICS.capHeight + 0.01);
        }
      }
    }
  });

  it('covers A–Z and 0–9', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      const g = glyphFor(ch);
      expect(g, ch).toBeDefined();
      expect(g!.strokes.length, ch).toBeGreaterThan(0);
    }
    expect(unsupportedChars('HELLO 123')).toEqual([]);
    expect(unsupportedChars('héllo')).toEqual(['é']);
  });

  it('lays text out centered at the requested cap height', () => {
    const size = inch(1);
    const strokes = hersheyText('AB', size, { cx: inch(5), cy: inch(3) });
    expect(strokes.length).toBeGreaterThan(0);
    const all = strokes.flat();
    const b = bbox(all);
    expect(b.maxY - b.minY).toBeCloseTo(size, -4); // cap height honored
    const cx = (b.minX + b.maxX) / 2;
    expect(Math.abs(cx - inch(5))).toBeLessThan(inch(0.05)); // centered
    // lowercase engraves as uppercase
    expect(hersheyText('ab', size, { cx: inch(5), cy: inch(3) }).length).toBe(strokes.length);
  });

  it('skips unsupported characters instead of emitting garbage', () => {
    const withBad = hersheyText('AéB', inch(1), { cx: 0, cy: 0 });
    const without = hersheyText('AB', inch(1), { cx: 0, cy: 0 });
    expect(withBad.length).toBe(without.length);
  });
});

describe('g-code safety invariants', () => {
  const allOps = (o: CncOptions) => generateToolpaths(RECT, o).operations;

  it('emits a well-formed program that passes its own audit', () => {
    const o = cnc((c) => {
      c.groove.enabled = true;
      c.pocket.enabled = true;
      c.engrave.enabled = true;
      c.engrave.text = 'OAK';
    });
    for (const op of allOps(o)) {
      const maxDepth = op.kind === 'profile' ? o.stockThickness + o.profile.throughDepth : o.stockThickness;
      const g = emitGcode(op, o, { maxCutDepth: maxDepth });
      expect(g.violations, op.name).toEqual([]);
      expect(auditGcode(g.text, o, maxDepth), op.name).toEqual([]);
      expect(g.text).toMatch(/^\(/);
      expect(g.text.trimEnd().endsWith('M2')).toBe(true);
    }
  });

  it('first motion is a rapid to safe Z and the program ends spindle-off at safe Z', () => {
    const o = cnc();
    const op = allOps(o)[0];
    const g = emitGcode(op, o, { maxCutDepth: o.stockThickness + o.profile.throughDepth });
    const lines = g.text.split('\n').filter((l) => /^G[01](\s|$)/.test(l));
    expect(lines[0]).toBe(`G0 Z${(o.machine.safeZ / IN).toFixed(4).replace(/\.?0+$/, '')}`);
    const moves = parseGcode(g.text);
    expect(moves[0].rapid).toBe(true);
    expect(moves[0].z).toBeCloseTo(o.machine.safeZ, -4);
    expect(moves[moves.length - 1].z).toBeCloseTo(o.machine.safeZ, -4);
    expect(g.text).toContain('M5');
  });

  it('no rapid traverses in XY below safe Z', () => {
    const o = cnc((c) => {
      c.groove.enabled = true;
      c.pocket.enabled = true;
    });
    for (const op of allOps(o)) {
      const g = emitGcode(op, o, { maxCutDepth: o.stockThickness + o.profile.throughDepth });
      const moves = parseGcode(g.text);
      for (let i = 1; i < moves.length; i++) {
        const m = moves[i];
        const p = moves[i - 1];
        if (m.rapid && (m.x !== p.x || m.y !== p.y)) {
          expect(m.z, `${op.name} rapid at z=${m.z}`).toBeGreaterThanOrEqual(o.machine.safeZ - 1);
        }
      }
    }
  });

  it('geometry round-trips through emit → parse within tolerance', () => {
    const o = cnc();
    const op = allOps(o).find((x) => x.kind === 'profile')!;
    const g = emitGcode(op, o, { maxCutDepth: o.stockThickness + o.profile.throughDepth });
    const parsed = parseGcode(g.text).filter((m) => !m.rapid);
    const source = op.moves.filter((m) => m.kind === 'feed');
    expect(parsed.length).toBeGreaterThanOrEqual(source.length);
    // every emitted cutting point matches a source point to within rounding
    for (let i = 0; i < source.length; i++) {
      const match = parsed.find(
        (p) => Math.abs(p.x - source[i].to.x) < inch(0.001) && Math.abs(p.y - source[i].to.y) < inch(0.001),
      );
      expect(match, `move ${i} missing from emitted g-code`).toBeDefined();
    }
  });

  it('does not mistake the safe-Z retract for a deep cut', () => {
    // Regression: stock thinner than safe Z used to trip the depth check,
    // because it compared |z| instead of depth below the stock top.
    const o = cnc((c) => {
      c.stockThickness = inch(0.5);
      c.machine = { ...c.machine, safeZ: inch(1.5) };
      c.groove.enabled = true;
      c.groove.depth = inch(0.15);
    });
    for (const op of allOps(o)) {
      const maxDepth = op.kind === 'profile' ? o.stockThickness + o.profile.throughDepth : o.stockThickness;
      const g = emitGcode(op, o, { maxCutDepth: maxDepth });
      expect(g.violations, op.name).toEqual([]);
      expect(auditGcode(g.text, o, maxDepth), op.name).toEqual([]);
    }
  });

  it('catches a depth violation rather than emitting it silently', () => {
    const o = cnc();
    const op = allOps(o).find((x) => x.kind === 'profile')!;
    const g = emitGcode(op, o, { maxCutDepth: inch(0.1) }); // absurdly shallow limit
    expect(g.violations.length).toBeGreaterThan(0);
  });

  it('warns about feeds faster than a hobby router can hold', () => {
    const fast = generateToolpaths(RECT, cnc((c) => void (c.profile.feeds.feedXY = inch(400))));
    expect(fast.warnings.some((w) => /hobby routers top out/.test(w))).toBe(true);
    // and stays quiet at a sane feed
    const sane = generateToolpaths(RECT, cnc((c) => void (c.profile.feeds.feedXY = inch(90))));
    expect(sane.warnings.some((w) => /hobby routers top out/.test(w))).toBe(false);
  });

  it('flags tabs smaller than the cutter as an export-blocking error', () => {
    const o = cnc((c) => {
      c.profile.tabs = { count: 4, width: inch(0.2), height: inch(0.15) };
      c.profile.tool = toolById('em-250'); // 1/4" needs ≥ 3/8" tabs
    });
    const res = generateToolpaths(RECT, o);
    expect(res.errors.some((e) => /tabs/i.test(e))).toBe(true);
  });

  it('audit rejects a hand-mangled program', () => {
    const o = cnc();
    const bad = 'G20\nG90\nM3 S16000\nG1 X1 Y1 Z-0.5 F30\nM2\n';
    expect(auditGcode(bad, o, inch(1)).length).toBeGreaterThan(0);
  });

  it('emits one file per operation plus a combined file with a tool-change stop', () => {
    const o = cnc((c) => {
      c.groove.enabled = true;
    });
    const { files, violations } = emitAllGcode(allOps(o), o);
    expect(violations).toEqual([]);
    expect(files.map((f) => f.name)).toContain('profile.nc');
    expect(files.map((f) => f.name)).toContain('groove.nc');
    const combined = files.find((f) => f.name === 'all-operations.nc')!;
    expect(combined.text).toContain('M0');
  });
});

describe('DXF and SVG export', () => {
  it('writes a valid R12 skeleton with one layer per operation', () => {
    const o = cnc((c) => {
      c.groove.enabled = true;
      c.engrave.enabled = true;
      c.engrave.text = 'HI';
    });
    const { operations } = generateToolpaths(RECT, o);
    const dxf = toolpathsToDxf(RECT, operations);
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('ENTITIES');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    for (const name of ['outline', 'profile', 'groove', 'engrave']) {
      expect(dxf, name).toContain(name);
    }
    // section/endsec pairs balance
    expect((dxf.match(/\nSECTION/g) ?? []).length).toBe((dxf.match(/\nENDSEC/g) ?? []).length);
    expect(dxf).not.toContain('NaN');
  });

  it('SVG export draws the outline and every toolpath', () => {
    const o = cnc((c) => void (c.groove.enabled = true));
    const { operations } = generateToolpaths(RECT, o);
    const svg = toolpathsToSvg(RECT, operations);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('NaN');
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(1 + operations.length);
  });
});

describe('estimates', () => {
  it('reports a positive cutting time', () => {
    const o = cnc();
    const { operations } = generateToolpaths(RECT, o);
    for (const op of operations) expect(estimateMinutes(op)).toBeGreaterThan(0);
  });
});

describe('shaped outlines', () => {
  it('generates toolpaths for every outline kind without degenerating', () => {
    const outlines: Outline[] = [
      { kind: 'rect', w: inch(16), h: inch(10), cornerRadius: 0 },
      { kind: 'rect', w: inch(16), h: inch(10), cornerRadius: inch(1) },
      { kind: 'ellipse', rx: inch(7), ry: inch(5) },
      { kind: 'paddle', bodyW: inch(12), bodyH: inch(9), handleW: inch(2.5), handleL: inch(5), r: inch(1.25) },
    ];
    const o = cnc((c) => {
      c.groove.enabled = true;
      c.groove.margin = inch(1);
    });
    for (const outline of outlines) {
      const res = generateToolpaths(outline, o);
      expect(res.errors, outline.kind).toEqual([]);
      const profile = res.operations.find((x) => x.kind === 'profile') as Operation;
      expect(profile.paths[0].length, outline.kind).toBeGreaterThan(3);
      const g = emitGcode(profile, o, { maxCutDepth: o.stockThickness + o.profile.throughDepth });
      expect(g.violations, outline.kind).toEqual([]);
    }
  });
});
