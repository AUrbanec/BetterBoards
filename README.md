# BetterBoards

A local-first, browser-based design tool for woodworkers building cutting boards — edge-grain,
end-grain, checkerboard, brick, chevron, and herringbone patterns — with **kerf-aware cut lists**,
dimensioned blueprints, and procedural build instructions.

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
npm run serve      # serves dist/ via npx serve
```

`dist/` is a plain static bundle — any file server works, and it runs fully offline.

## What it does

- **Design** — layer-stack editor with repeat groups; type widths the way you'd say them
  (`1 3/4`, `1.75`, `44mm`). Templates for stripes, three-wood bands, checkerboard, brick,
  chevron, herringbone, diagonal accent, and seeded-random rustic.
- **Live views** — finished top view, glue-up #1 cross-section, and a crosscut plan with numbered
  cut lines. Click any slice to flip or rotate it individually.
- **Cut list** — rip schedule, crosscut schedule, rough board feet per species (with milling
  allowances and a waste factor), glue/clamp estimates, and a full allowances audit box.
- **Species** — 30-species database with Janka, porosity, movement, and curated cautions.
  Match a target color (or eyedrop an inspiration photo) ranked by ΔE2000, filtered by food-safety,
  Janka window, grain, price, or your own inventory.
- **Checks** — manufacturability lint (sub-kerf strips, open-pore share, movement mismatch, soft or
  knife-dulling species, slice-count sanity, rounding drift), each with a plain-English "why".
- **Export** — printable blueprint (4 pages), SVG, Excel-safe CSV cut list, Markdown instructions,
  and a versioned `.cbproj` project file. Undo/redo and localStorage autosave throughout.

## Precision

Dimensions are stored as **integer nanometers** (1″ = 25,400,000 nm exactly; 1/64″ = 396,875 nm).
Every engine operation is exact integer arithmetic — floats appear only in color science and
rendering. The cut list displays to 1/32″ and reports the exact decimal whenever rounding occurred,
plus a cumulative-drift warning if the total exceeds half a kerf.

## Development

```bash
npm test           # 51 unit + property tests
npm run typecheck  # tsc --noEmit (strict)
npm run demo       # prints a cut list for a striped board
node scripts/smoke.mjs /tmp/shots           # browser smoke test with screenshots
npx tsx scripts/blueprint-preview.mjs chevron /tmp/bp   # render blueprint pages to PNG
```

The engine (`src/engine/`) is pure and UI-free: units, construction pipeline, cut list, color,
patterns, validation. The UI (`src/ui/`) and exports (`src/exports/`) only consume its output.

## Docs

- [`docs/status.md`](docs/status.md) — what's built, what's next
- [`docs/math.md`](docs/math.md) — the construction pipeline and shop-math conventions
- [`docs/file-format.md`](docs/file-format.md) — `.cbproj` specification
- [`docs/plan.md`](docs/plan.md) — the original design plan

## Disclaimer

Species data (Janka, movement, color, price) and all allowances are **starting points**. Wood varies;
verify against your own stock before cutting. The app advises — it never blocks a design choice.
