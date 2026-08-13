# BetterBoards

A local-first, browser-based design tool for woodworkers building cutting boards — edge-grain,
end-grain, checkerboard, chevron, pinwheel, and tumbling-block patterns, in any shape from a
rectangle to a handled paddle — with **kerf-aware cut lists**, dimensioned blueprints, procedural
build instructions, and CNC output.

All geometry is deterministic integer math. **No LLMs, no network calls, no accounts.** The cut list
is not inferred from the picture; the picture is rendered *from* the cut list, so the drawing and the
numbers can never disagree.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

To use it as a local app:

```bash
npm run build
npm run serve         # serves dist/ via npx serve

npm run build:single  # dist-single/index.html — one file, opens with no server at all
```

`dist/` is a plain static bundle — any file server works, and it runs fully offline. The
single-file build inlines everything into one ~330 KB HTML file you can open straight from disk.

## What it does

- **Patch studio** — an interactive designer: drag angular shapes onto a snap grid, rotate and
  mirror individual patches or the whole design, and watch the cut list stay exact. The lattice is
  the point — it is what lets every patch reduce to a real cut.
- **Build stages** — the app tells you how many glue-ups and machining stages a design needs, and
  numbers them. A striped board is one glue-up; a checkerboard is two; a curve or a patch design is
  three. The timeline and the printed instructions come from the same source.
- **Design** — layer-stack editor with repeat groups; type widths the way you'd say them
  (`1 3/4`, `1.75`, `44mm`). 16 templates: stripes, three-wood bands, checkerboard, brick,
  chevron, herringbone, diagonal accent, paddle, round, pinwheel, basket weave, tumbling blocks,
  parabolic arch, parabolic lens, a patch-studio star, and seeded-random rustic.
- **Shapes** — rectangle (with corner radius), ellipse/circle, filleted paddle, or a custom
  polygon. The outline is cut from the blank, so it never changes the glue-up.
- **Live views** — finished top view, glue-up #1 cross-section, a crosscut plan with numbered
  cut lines, a rotatable 3-D preview, and the CNC toolpaths. Click any slice to flip or rotate it.
- **Cut list** — rip schedule, crosscut schedule, rough board feet per species (with milling
  allowances and a waste factor), glue/clamp estimates, and a full allowances audit box.
- **Species** — 30-species database with Janka, porosity, movement, and curated cautions.
  Match a target color (or eyedrop an inspiration photo) ranked by ΔE2000, filtered by food-safety,
  Janka window, grain, price, or your own inventory.
- **Checks** — manufacturability lint (sub-kerf strips, open-pore share, movement mismatch, soft or
  knife-dulling species, slice-count sanity, rounding drift), each with a plain-English "why".
- **CNC** — perimeter profile with holding tabs, juice groove, handle recess, and single-line
  engraving. Machine profiles for GRBL/Shapeoko/Onefinity/LinuxCNC, chipload-based feeds, a
  toolpath visualizer, and a self-auditing G-code emitter that refuses to write an unsafe file.
- **Stock optimizer** — packs the project's parts onto the boards you actually own and reports
  utilization, offcuts, and shortfall.
- **Export** — printable blueprint (up to 5 pages), SVG, Excel-safe CSV cut list, Markdown
  instructions, G-code / DXF / SVG toolpaths, and a versioned `.cbproj` project file.
  Undo/redo and localStorage autosave throughout.

## Precision

Dimensions are stored as **integer nanometers** (1″ = 25,400,000 nm exactly; 1/64″ = 396,875 nm).
Every engine operation is exact integer arithmetic — floats appear only in color science and
rendering. The cut list displays to 1/32″ and reports the exact decimal whenever rounding occurred,
plus a cumulative-drift warning if the total exceeds half a kerf.

## Development

```bash
npm test           # 163 unit + property tests
npm run typecheck  # tsc --noEmit (strict)
npm run demo       # prints a cut list for a striped board
node scripts/smoke.mjs /tmp/shots           # browser smoke test with screenshots
node scripts/cnc-check.mjs                 # CNC panel → toolpaths → G-code export
node scripts/v2-check.mjs                  # block patterns + 3-D preview
node scripts/singlefile-check.mjs          # single-file build, from file://
node scripts/v3-check.mjs                  # stages, curves, patch studio
npx tsx scripts/blueprint-preview.mjs chevron /tmp/bp   # render blueprint pages to PNG
```

The engine (`src/engine/`) is pure and UI-free: units, geometry, construction pipeline, cut list,
colour, patterns, validation, CNC. The UI (`src/ui/`) and exports (`src/exports/`) only consume
its output.

## Docs

- [`docs/status.md`](docs/status.md) — what's built, what's next
- [`docs/math.md`](docs/math.md) — the construction pipeline and shop-math conventions
- [`docs/file-format.md`](docs/file-format.md) — `.cbproj` specification
- [`docs/plan.md`](docs/plan.md) — the original design plan

## Disclaimer

Species data (Janka, movement, color, price) and all allowances are **starting points**. Wood varies;
verify against your own stock before cutting. The app advises — it never blocks a design choice.
