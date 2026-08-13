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
npm run serve         # builds, then serves dist/ on localhost:3000
npm run serve:single  # builds the single-file bundle and serves it
npm run build:single  # dist-single/index.html — one file, opens with no server at all
npm run doctor        # diagnoses "it will not load" — see below
```

`npm run serve` and `npm run preview` build first, so they work from a clean
checkout (`dist/` is gitignored and will not exist until something builds it).
Both serve the build with `vite preview`, which needs no extra download and
already knows the host settings below.

### Running in Codespaces, Gitpod, or another cloud IDE

It works out of the box — `npm run dev`, then open the URL it prints. In a cloud
IDE the commands print the exact forwarded URL to open, because `localhost` is
not reachable from your browser there.

**If you get a 404, you are almost certainly on the wrong port.** The two
commands run two different servers:

| command | port | URL |
| --- | --- | --- |
| `npm run dev` | 5173 | `https://<codespace>-5173.app.github.dev/` |
| `npm run serve` | 3000 | `https://<codespace>-3000.app.github.dev/` |

A forwarded port with nothing listening on it answers **HTTP 404**, and the
browser then draws its own "No webpage was found for the web address" page. That
looks like a broken app but means *nothing is serving that port* — either the
other command is the one running, or the server has not finished starting
(`npm run serve` type-checks and builds first, which takes a few seconds).

Run `npm run doctor` to have all of this checked for you: it reports which ports
have a server, prints the URL for each, boots a dev and a preview server on spare
ports, and requests them through your real forwarded hostname.

Three things are configured for you, worth knowing if you hit trouble:

- **Vite ≥ 6 refuses unrecognised `Host` headers** with `403 Blocked request.
  This host is not allowed.` Because you reach a cloud IDE through a forwarded
  hostname rather than localhost, the bare default rejects every request.
  `vite.config.ts` allows the usual forwarding domains (`*.app.github.dev`,
  `*.gitpod.io`, and friends). Add yours to `FORWARDED_HOSTS` if you use a
  different one.
- **The ports are pinned** (`strictPort`). Without it Vite quietly moves to the
  next free port when 5173 is busy, and the forwarded URL you were given then
  points at nothing — another 404. Now it fails loudly instead, naming the
  conflict.
- **The dev server binds `0.0.0.0`** so port forwarding can reach it, and HMR is
  pointed at port 443 when `CODESPACES` is set, since TLS terminates at the
  proxy.

`.devcontainer/devcontainer.json` deliberately does **not** pre-declare
`forwardPorts`: doing so publishes those URLs at container start, before any
server exists, so the Ports panel advertises links that 404 until you start
something. Ports forward on their own as soon as a server listens.

If a forwarded URL still 404s with the right port running, check that port's
**visibility** in the Ports panel — a private port opened from a browser session
without access to the codespace will not reach your server.

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
