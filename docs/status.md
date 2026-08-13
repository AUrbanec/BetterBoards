# Build status

Phase numbering follows [`plan.md`](./plan.md) §13. **All eight phases are implemented.**

## MVP (phases 1–5)

| Phase | Scope | Acceptance |
|---|---|---|
| 1 — Engine foundation | `units.ts`, core types, edge-grain pipeline, cut list | ✅ `npm run demo` prints a correct striped-board cut list |
| 2 — End grain + transforms | Square & angled crosscut math, slice transforms, cell grid | ✅ Golden 24-slice case and chevron waste triangles verified; property tests pass |
| 3 — App shell + 2D editor | Vite/React/Zustand, layer editor, canvas views, undo, autosave, units, templates | ✅ Checkerboard designed end to end in a real browser; reload restores state |
| 4 — Species + recommender | 30-species DB, ΔE2000, picker UI, inventory, lint rules | ✅ Colour match returns a sensible ranked list; inventory filter and price overrides work |
| 5 — Exports v1 | Blueprint SVG/print, CSV, instructions, `.cbproj` | ✅ 18″ board draws at 6″ on letter at the stated 1:3 |

## V2 (phases 6–8)

| Phase | Scope | Acceptance |
|---|---|---|
| 6 — Outlines & clipping | Rounded rect, ellipse/circle, filleted paddle, custom polygon; grid clipping; blank validation; shaping blueprint page | ✅ Paddle and round boards preview, clip, and export; glue-up provably unchanged by shape |
| 7 — CNC | Offsetting, profile with tabs, juice groove, pocket, engraving, machine profiles, G-code + DXF + SVG, visualizer | ✅ Emitted G-code passes the safety audit and round-trips through parse-back; verified in Chromium |
| 8 — V2 patterns & polish | Pinwheel, basket weave, tumbling blocks, 3-D preview, stock optimizer, single-file build | ✅ All 13 templates render; `dist-single/index.html` runs from `file://` with no server |

### Two deliberate departures from the plan

1. **Engraving font.** The plan specified bundled Hershey fonts. Transcribing
   Hershey's packed encoding is error-prone, and a corrupted glyph becomes a
   wrong cut in a real board. `engine/cnc/hershey.ts` instead holds an explicit,
   readable stroke table (A–Z, 0–9, punctuation) that tests verify stays inside
   its glyph box. Lowercase engraves as uppercase; unsupported characters are
   reported rather than guessed.
2. **3-D preview.** The plan specified three.js. A cutting board is an extruded
   flat polygon, so `ui/components/Preview3D.tsx` software-projects it to SVG
   with painter ordering — rotatable, ~250 lines, no 600 KB dependency, and it
   prints and exports as vector like everything else. Per-species *textures*
   (as opposed to tones) are the one thing this gives up.

## V3 — multi-stage builds, curves, interactive designer

| Feature | What it does |
|---|---|
| Build stages | `exports/stages.ts` derives every step and numbers the glue-ups. Instructions and the on-screen timeline render from that one list, so they cannot disagree. The timeline chips expand to the full step text. |
| Parabolic curves | Straight crosscuts whose chords trace a parabola — arch or lens, optional accent line following the curve, per-column miter angles in the cut list. |
| Patch studio | Drag-and-drop designer on a snap lattice: 8 patch shapes, per-patch rotate/mirror, whole-design mirror H/V and rotate, resizable grid, live exact cut list. |

The designer is deliberately constrained to a lattice and a fixed palette. Free
placement would make an accurate cut list impossible; a lattice makes it
arithmetic. This is the same trade quilt design software makes, and the research
behind that choice is in the commit history.

## Verification

```bash
npm test              # 163 tests
npm run typecheck     # strict, clean
npm run build         # dist/
npm run build:single  # dist-single/index.html — one file, runs offline
npm run demo          # cut list for a striped board

node scripts/smoke.mjs /tmp/shots              # 13-step browser flow
node scripts/cnc-check.mjs                     # CNC panel → toolpaths → G-code download
node scripts/v2-check.mjs                      # block patterns + 3-D preview
node scripts/singlefile-check.mjs              # single-file build from file://
node scripts/v3-check.mjs                     # stages, curves, patch studio
npx tsx scripts/blueprint-preview.mjs chevron /tmp/bp   # blueprint pages → PNG
```

Test coverage by area: units and fractions (6), CIEDE2000 against the full
Sharma dataset (5), pipeline golden cases and transforms (15), fast-check
properties (6), cut list (5), lint rules (7), exports (7), geometry and
offsetting (19), outlines (14), CNC and G-code safety (29), block patterns and
the stock optimizer (21).

## Bugs the checks caught during V2

Worth recording, because each one is a case where a test or a visual check
earned its keep:

- `offsetRing` had its convex-corner test inverted, so outward offsets mitered
  instead of arcing — caught by an offset-distance invariant.
- The G-code depth guard compared `|z|`, so the positive safe-Z retract read as
  a deep cut. Masked in tests because the default stock thickness happened to
  equal safe Z; found when a ¾″ board tripped it in the browser.
- The profile operation stored the pre-reversal path, so the visualizer showed
  the wrong cut direction for climb milling.
- The canvas guarded on `rows.length === 0`, which is always true for polygon
  grids, so block patterns rendered blank.
- The cut list grouped pieces by species and size only, so a square and a
  half-square triangle of the same dimensions merged into one line — telling the
  user to cut 15 squares when 11 of them needed a diagonal cut. Caught by reading
  a rendered cut list, not by a test; now grouped by shape, with a regression test.

## Not built

- **Drag-to-reorder** in the layer stack (buttons work; the plan asks for drag).
- **Colour-blind-safe mode** beyond the existing species-letter toggle.
- **True V-carve** engraving (depth-varying width). The plan puts this out of
  scope; engraving is fixed-depth centreline only.
- **2-D nesting** in the stock optimizer — it packs by length per part, which is
  the honest model for rip-then-crosscut. Real sheet nesting would need a
  guillotine solver.
- **Browser tests in `npm test`.** The Playwright checks live in `scripts/` and
  run separately; folding them in needs a headless test-runner setup.
