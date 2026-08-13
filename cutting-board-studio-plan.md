# Cutting Board Studio — Implementation Plan for Claude Code

A locally run, browser-based design tool for woodworkers to design cutting boards (edge-grain, end-grain, chevron, brick, and 3D-illusion patterns), then generate accurate blueprints, kerf-aware cut lists, procedural build instructions, and optional CNC output (SVG/DXF/G-code). All geometry is deterministic math — **no LLMs anywhere in the product**.

---

## 0. Guiding Principles

1. **Deterministic geometry only.** Every pattern is produced by an invertible "construction pipeline" (rip → glue → crosscut → rotate/flip → glue). The cut list is not inferred from the picture; the picture is *rendered from* the cut list. This guarantees the blueprint and cut list can never disagree.
2. **Local-first.** No server required at runtime. Ships as a Vite static build; `npm run dev` for development, `npm run preview` or any static file server (or a packaged single `index.html`) for use. All state lives in the browser (localStorage autosave) and in user-exported `.cbproj` JSON files.
3. **Units are exact.** Store all dimensions internally as **integer micrometers** (or rational fractions of an inch — see §4.1) to avoid floating-point drift in cut lists. Convert to in/mm only at the display layer. Imperial display supports fractional (1/32" resolution) and decimal modes.
4. **Everything validates.** The engine refuses or warns on physically impossible or bad-practice designs (see §9).
5. **Test the math first.** The geometry engine is a pure, UI-free TypeScript package with exhaustive unit tests, built and verified before any UI exists.

---

## 1. Research Summary (context for design decisions)

Findings from surveying existing tools (CBdesigner, cuttingboarddesigner.com, Cutting Board Designer 3D app, and several online end-grain calculators):

- Existing tools model a board as a **stack of layers** (strips), each with a species, width, and optionally a trailing angle; end-grain boards are produced by crosscutting the first glue-up and flipping/rotating alternating slices. This layer-stack + slice-transform model covers checkerboards, stripes, chevrons, herringbone, basket-weave, and pinwheels.
- The best modern tools provide: live 2D + rotatable 3D preview, kerf-aware cut lists, slice counts, finished dimensions, board-feet per species, templates, imperial/metric toggle, and **warnings when a cut is geometrically impossible**.
- Established material math conventions (adopt these):
  - Edge-grain: raw stock width = Σ(strip widths) + (number of rip cuts × kerf) + cleanup allowance.
  - End-grain slice count: `slices = ceil(finished_length / slab_thickness_after_planing)`; slab length needed = `slices × finished_thickness + slices × kerf + end trim`.
  - Board feet computed on **rough** stock (add ~1/4" to width and thickness for jointing/planing loss), plus a configurable waste factor (default 15–20%).
  - Default kerf 1/8" (0.125"), thin-kerf option 3/32" (0.094"), fully user-editable.
- Gaps in existing tools that this app will fill: species recommendation by color with a user-owned inventory filter, arbitrary board outlines (not just rectangles), CNC export (profile, juice groove, engraving), printable dimensioned blueprints, procedural step-by-step instructions, and manufacturability lint (wood-movement warnings, minimum strip width vs. kerf, etc.).

---

## 2. Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| App shell | **Vite + React 18 + TypeScript (strict)** | Fast local dev, static build, no server |
| State | **Zustand** (with undo/redo middleware) | Simple, serializable store → project files |
| 2D rendering | **SVG (React components)** for the design canvas & blueprints | Vector output doubles as export format; print-friendly |
| 3D preview | **three.js** (optional module, lazy-loaded) | Extruded box geometry per piece; texture per species |
| Polygon boolean ops | **`polygon-clipping`** (Martinez-Rueda) or **Clipper2 WASM** | Robust intersection/difference for clipping pattern grids to board outlines and juice-groove offsetting |
| Geometry offsets | Clipper2 `InflatePaths` (for juice groove / tool-radius offset) | Battle-tested polygon offsetting with arc joins |
| Color math | Small in-house module: sRGB ↔ CIELAB, **ΔE2000** | ~150 lines, no dependency needed |
| PDF export | **`pdf-lib`** or `svg2pdf.js` + `jsPDF` | Blueprint/cut-list PDFs generated client-side |
| DXF export | In-house writer (DXF R12 ASCII, LINE/ARC/LWPOLYLINE entities) | R12 is trivially simple and universally imported by CAM software |
| G-code | In-house generator (see §8.3) targeting **GRBL/Marlin-style RS-274** | Full control over safety moves; no suitable library covers pocketing + profiles + tabs the way we need |
| Testing | **Vitest** + fast-check (property-based tests) | Pure-math engine is highly testable |
| Packaging | `npm run build` → `dist/`; provide `npx serve dist` script and optionally a single-file build via `vite-plugin-singlefile` | "Locally run webapp" with zero install friction |

**Monorepo layout (single package is fine, but keep boundaries hard):**

```
cutting-board-studio/
├── src/
│   ├── engine/            # PURE math. No React, no DOM. 100% unit-tested.
│   │   ├── units.ts       # exact dimension type, conversions, fraction formatting
│   │   ├── geometry/      # vectors, polygons, transforms, clipping wrappers
│   │   ├── construction/  # pipeline: rip → glue → crosscut → arrange (§5)
│   │   ├── patterns/      # parametric generators (§6)
│   │   ├── cutlist/       # stock optimization, board feet, kerf accounting (§7)
│   │   ├── color/         # sRGB↔Lab, ΔE2000, species matching (§7.5)
│   │   ├── validate/      # manufacturability lint rules (§9)
│   │   └── cnc/           # toolpath gen: profile/pocket/groove/engrave → G-code, DXF (§8.3)
│   ├── data/
│   │   └── species.json   # wood species database (§4.3)
│   ├── exports/           # SVG blueprint composer, PDF builder, instruction generator
│   ├── ui/                # React components
│   └── store/             # Zustand slices, undo/redo, autosave, project I/O
├── tests/                 # golden-case + property tests for engine/
└── docs/                  # this plan, math notes, file-format spec
```

---

## 3. Feature Scope

### MVP (Phases 1–5)
- Rectangular boards; edge-grain and end-grain construction
- Layer-stack editor (species, width, count, repeat groups)
- Slice transforms: flip alternate, rotate 180°, shift/offset (brick), reverse
- Patterns via templates: stripes, checkerboard, brick/running bond, chevron, herringbone, diagonal accent, 3-wood bands
- Live 2D preview (face + end views), finished-dimension readout
- Kerf-aware cut list with board feet per species, rough-stock allowances, waste factor
- Wood species DB (~30 species) + color-match recommendations + "my inventory" filter
- Blueprint PDF (dimensioned drawings + glue-up diagrams) and procedural instructions
- Project save/load (JSON), autosave, undo/redo, imperial/metric

### V2 (Phases 6–8)
- Arbitrary outlines: rounded rectangle, ellipse/circle, paddle/handle shapes, custom polygon editor
- CNC module: perimeter profile with tabs, juice groove, handle slot pocket, chamfer/roundover note sheet, V-carve monogram engraving from single-line fonts (Hershey fonts — pure polyline data, no LLM)
- DXF + SVG + G-code export with machine profiles (GRBL default; LinuxCNC/Mach variants differ only in header/footer)
- 3D preview (three.js) with per-species textures
- Pinwheel / basket-weave / tumbling-blocks (3D illusion) generators
- Stock optimizer: fit required strips onto user-entered lumber inventory (1D bin packing)

### Explicitly out of scope
- Anything cloud, accounts, or AI/LLM-based
- Full 3D sculpted surfaces (juice groove & flat pockets only)
- Automatic photo-to-pattern conversion

---

## 4. Domain Model

### 4.1 Exact dimensions (`engine/units.ts`)

```ts
// Internal unit: 1 "iu" = 1/9600 inch  (LCM-friendly: exact for 1/2,1/4,…,1/64" AND
// exact-ish for mm: 1 mm = 377.9527... iu — so instead:)
// DECISION: store as integer micrometers (µm). 1 inch = 25400 µm exactly.
// Every imperial fraction down to 1/64" is an integer µm (25400/64 = 396.875 → NOT integer).
// FINAL DECISION: store nanometers as bigint-free `number` (1 in = 25_400_000 nm).
// 1/64 in = 396_875 nm (integer). 1 mm = 1_000_000 nm (integer). Max board ~1 m ≈ 1e9 nm,
// well within Number.MAX_SAFE_INTEGER. All engine arithmetic on integers; display converts.
export type Nm = number; // integer nanometers
export const IN = 25_400_000, MM = 1_000_000;
export const inch = (x: number): Nm => Math.round(x * IN);
export function formatFraction(nm: Nm, denom?: 8|16|32|64): string; // "1 3/8""
```

Claude Code: implement `formatFraction` with proper reduction and a "nearest 1/32 with ± tolerance flag" mode for the cut list (woodworkers cut to 1/32; show exact decimal in parentheses when rounding occurred).

### 4.2 Core types (`engine/construction/types.ts`)

```ts
type SpeciesId = string;

interface Strip {            // one rip-cut stick in glue-up #1
  species: SpeciesId;
  width: Nm;                 // across the glue-up (visible stripe width)
  thickness: Nm;             // stock thickness after milling
  length: Nm;                // derived from downstream needs + trim
}

interface LayerGroup {       // UI concept: N repeats of an ordered strip sequence
  strips: Omit<Strip,'length'|'thickness'>[];
  repeat: number;
}

type SliceTransform =
  | { kind: 'none' }
  | { kind: 'flipAlternate' }        // classic checkerboard
  | { kind: 'rotate180Alternate' }
  | { kind: 'reverseAlternate' }     // mirror slice order
  | { kind: 'shift', by: Nm, alternate: boolean }   // brick / running bond
  | { kind: 'sequence', ops: PerSliceOp[] };        // fully explicit per-slice list

interface Board {
  name: string;
  outline: Outline;          // §4.4 — Rect for MVP
  construction:
    | { kind: 'edgeGrain', layers: LayerGroup[] }
    | { kind: 'endGrain',
        layers: LayerGroup[],          // glue-up #1 composition (defines slice pattern)
        crosscut: { width: Nm, angle: DegExact }, // angle 90 = square; 45/60 = chevron
        transform: SliceTransform,
        sliceCount: number };          // derived, but stored for explicit override
  kerf: Nm;                  // default inch(0.125)
  cleanup: { widthTrim: Nm; lengthTrim: Nm; planingLoss: Nm }; // defaults 1/4", 1/2", 1/8"
  finish: { thickness: Nm };
  cncOptions?: CncOptions;   // §8.3
}
```

### 4.3 Wood species database (`data/species.json`)

Ship ~30 entries. Schema:

```jsonc
{
  "id": "hard-maple",
  "commonName": "Hard Maple (Sugar Maple)",
  "botanical": "Acer saccharum",
  "colorLab": { "L": 82, "a": 3, "b": 16 },        // representative heartwood/sapwood tone
  "colorRangeLab": [{...light}, {...dark}],          // min/max for range display
  "displayHex": "#E8D3A9",                            // derived from Lab; used for rendering
  "textureTint": ["#E8D3A9", "#DCC48F"],             // 2-tone for procedural grain rendering
  "janka_lbf": 1450,
  "foodSafe": true,                                   // curated flag
  "notes": ["closed grain", "the benchmark cutting-board wood"],
  "cautions": [],                                     // e.g. purpleheart: ["sensitizer dust", "use as accent only"]
  "porosity": "closed",                               // closed | semi | open  (open → warn, see §9)
  "avgPricePerBF_usd": 8.5,                           // editable by user; used for cost estimate
  "movement": { "tangential": 9.9, "radial": 4.8 },  // % shrinkage green→ovendry (for §9 checks)
  "availability": "common"                            // common | specialty | exotic
}
```

Seed list (curate Lab values from published wood-color references; verify each during implementation):
**Core food-safe set:** hard maple, soft maple, black walnut, black cherry, white oak*, red oak*, beech, birch, ash, hickory, teak*, acacia, sapele, jatoba, purpleheart*, padauk*, yellowheart, bloodwood, wenge*, zebrawood, bubinga, canarywood, mahogany (genuine), white ash, sycamore, aspen (too soft → flagged), pine (flagged), bamboo (flagged: silica), poplar (flagged: soft).
Entries marked * get `cautions` (open pores, silica/knife dulling, dust sensitizer, "accent stripes only" etc.). The Janka sweet spot used by the recommender is **900–1500 lbf** (configurable), matching common cutting-board guidance; harder species allowed but warned ("dulls knives"), softer warned ("scars easily").

`foodSafe`, Janka, and porosity flags gate the **recommender**, but the user can always override — the app advises, never blocks species choice.

### 4.4 Outline

```ts
type Outline =
  | { kind: 'rect', w: Nm, h: Nm, cornerRadius: Nm }
  | { kind: 'ellipse', rx: Nm, ry: Nm }
  | { kind: 'paddle', bodyW: Nm, bodyH: Nm, handleW: Nm, handleL: Nm, r: Nm }
  | { kind: 'polygon', points: Vec2[], filletRadius?: Nm };   // V2 custom editor
```

Non-rectangular outlines do **not** change the glue-up (you always glue a rectangular blank that bounds the outline); they change (a) the rendered preview via polygon clipping of the pattern cells against the outline, (b) the blank-size calculation (bounding box + margin), and (c) the CNC profile path. This is the key simplification that keeps the math honest: **pattern generation and outline cutting are orthogonal stages, exactly as they are in a real shop.**

---

## 5. The Construction Pipeline (the "pure math" core)

Model every board as a sequence of shop operations on rectangles. Each stage is a pure function; the composition yields both the **preview geometry** and the **cut list** from a single source of truth.

### Stage A — Rip & Glue-up #1 (edge-grain slab)

Input: ordered strips `[s₁…sₙ]` (expanded from LayerGroups).
Output: slab of width `W₁ = Σ wᵢ`, thickness `T₁` (stock thickness), length `L₁` (computed backward from Stage B needs).

Raw lumber math (per species, for the cut list):
```
ripCuts        = strips_from_this_board − 1 (per source board; conservatively use n strips → n kerfs)
rawWidthNeeded = Σ(wᵢ) + n·kerf + cleanup.widthTrim
roughWidth     = each strip's finished width + 1/4"   (jointing allowance, rough lumber)
roughThickness = T₁ + planingLoss + 1/4" if starting from rough stock (user toggle: rough vs S4S)
boardFeet      = (roughThickness_in × roughWidth_in × length_in) / 144 × (1 + wasteFactor)
```

### Stage B — Crosscut slab into slices

Let finished board length (along the slice-stacking direction) be `L_f`, finished thickness `T_f`.

**Square crosscut (angle = 90°):**
```
sliceWidth  = T_f + planingLoss            // slice width becomes final thickness
sliceCount  = ceil(L_f / T₁eff)            // T₁eff = slab thickness after glue-up #1 planing
L₁          = sliceCount·sliceWidth + sliceCount·kerf + lengthTrim
```
(This is the standard, forum-verified end-grain formula: pieces = finished length ÷ slab thickness; slab length = pieces × finished thickness + pieces × kerf + trim.)

**Angled crosscut (chevron/herringbone), miter angle θ from the slab edge (θ=45° typical):**
- Slices are parallelograms. The along-slab advance per slice is `sliceWidth / sin θ`, and each stripe of width `wᵢ` in the slab appears in the slice with apparent width `wᵢ / sin θ` measured along the slice.
- Effective kerf consumed along the slab per cut = `kerf / sin θ`.
```
L₁ = sliceCount·(sliceWidth/sinθ) + sliceCount·(kerf/sinθ) + lengthTrim + endWasteTriangles
endWasteTriangles = T₁eff·|cotθ|      // two triangular offcuts at slab ends
```
- **Chevron** = pairs of slices with mirrored θ (cut half the slices with the miter gauge flipped, or flip alternate parallelogram slices face-down — the engine models this as `reflect` op and the instructions generator says which shop technique to use).
- **Herringbone** = chevron with `shift` transform offsetting each row by a fraction of the stripe pitch.

### Stage C — Arrange slices (transform) & Glue-up #2

Each slice is a 1D sequence of colored cells `[(species, apparentWidth)]`. Transforms are permutations/reflections on that sequence plus a row offset:

```
flipAlternate:      row i odd → reverse(cells)          // checkerboard when strips uniform
rotate180Alternate: reverse + species-preserving        // same as flip for 1D, distinct in 3D/texture
shift(by):          cells rotated cyclically by `by` (brick patterns); requires uniform pitch OR
                    generates edge partial-cells → engine computes the trim waste per row
```

Output of Stage C is the **cell grid**: an array of rows, each an array of `{species, x0, x1}` intervals, plus row `y0,y1`. This grid *is* the design. Everything downstream (SVG preview, 3D preview, blueprint, outline clipping) renders this grid.

### Stage D — Flatten, square, outline-cut

- Deduct `planingLoss` from thickness; note final sanded dimension.
- If outline ≠ rect: clip grid cells against outline polygon (polygon-clipping lib) for preview; blank must satisfy `outline.bbox + margin ≤ grid extents` (validated).

### Why this is sufficient ("it's just topology")

Every classic cutting-board pattern is the image of a product of interval partitions under the group generated by {reflection, 180° rotation, cyclic shift, shear (angled cut)}. The engine implements exactly those operators on interval sequences — no raster tricks, no fitting, no inference. Pinwheels and basket-weave (V2) extend Stage C to **2D block assembly**: glue-up #1 slabs are cut into rectangular blocks which are placed by a tiling function `place(i,j) → (blockId, rotation ∈ {0°,90°,180°,270°})`; the cut list then counts blocks per slab type. Tumbling-blocks/3D illusions are a fixed rhombille tiling with three species mapped to the three rhombus orientations; the construction is documented as an angled-rip (30°/60°) three-strip lamination — implement as its own parametric generator with its own cut-list derivation (well-documented shop technique; encode the geometry directly).

---

## 6. Pattern Library (parametric templates)

Each template = a function `params → Board` (it just fills the construction pipeline). Ship with live thumbnails.

| Template | Params | Pipeline setting |
|---|---|---|
| Classic stripes (edge grain) | species list, widths, repeat | edgeGrain |
| Checkerboard | 2 species, cell size, rows×cols | uniform strips = cell, square crosscut, flipAlternate |
| 3-wood bands | 3 species, band widths | edgeGrain or endGrain none |
| Brick / running bond | 2 species, brick w×h, offset % | shift(by = w·offset), alternate |
| Chevron | 2+ species, stripe width, θ (30–60°) | angled crosscut, mirrored pairs |
| Herringbone | stripe w, θ, row offset | angled + shift |
| Diagonal accent | base species + accent stripes, θ | angled, transform none |
| Pinwheel (V2) | 2 species, block size | 2D block tiling, rotation map |
| Basket weave (V2) | 2 species, slat ratio | 2D block tiling |
| Tumbling blocks (V2) | 3 species, rhombus size | dedicated generator |
| Random/rustic | species set + weights, seed | seeded PRNG choosing strip species (deterministic given seed — still no LLM) |

Every template remains fully editable after instantiation (templates are just presets, not modes).

---

## 7. Cut List & Materials Engine (`engine/cutlist/`)

Output object (rendered to screen + PDF + CSV):

1. **Per-species summary:** total strips, dimensions (T × W × L each), linear inches, board feet (rough, with waste factor), estimated cost (price/BF editable), suggested purchase sizes.
2. **Rip schedule (glue-up #1):** ordered list "Rip: 4 strips Walnut 1-3/4" × 1" × 26-1/2"", grouped identical cuts, with a per-source-board layout if inventory optimizer is on.
3. **Crosscut schedule:** slice count, slice width, angle, which slices get flipped/rotated (numbered diagram: "flip slices 2, 4, 6…").
4. **Allowances box:** kerf used, cleanup trims, planing loss, waste factor — all shown so the woodworker can audit.
5. **Glue math (nice-to-have):** total glue-joint area, clamp count suggestion (1 clamp per 6–8" of joint), titebond coverage estimate.
6. **Rounding report:** every dimension rounded to 1/32" shows the exact value; cumulative rounding error displayed and bounded (< 1 kerf across the board or a warning fires).

### 7.5 Species Recommendation Engine (`engine/color/`)

Pure color science, no ML:

1. User picks a target color (color picker, palette, or eyedropper on an inspiration image — canvas `getImageData`, average over a user-dragged region; still deterministic math).
2. Convert sRGB → linear RGB → XYZ (D65) → **CIELAB**.
3. Score every species by **ΔE2000** (implement the full CIEDE2000 formula with published test-vector verification — Sharma et al. dataset of 34 pairs as unit tests).
4. Filter/sort pipeline:
   - `inventoryOnly` toggle → restrict to user's species list (user manages an inventory screen: species, on-hand board feet, thicknesses, price paid).
   - Constraint chips: food-safe only (default ON), Janka window (default 900–1500, "accent" mode relaxes to allow purpleheart/padauk/wenge as ≤15%-of-area stripes), closed-grain preferred, budget ceiling.
   - Output: ranked list with swatch, ΔE badge ("excellent < 5, good < 10, fair < 20"), Janka, price, cautions.
5. **Palette suggestions:** given the design's species set, suggest high-contrast companions (maximize min pairwise ΔE, subject to constraints) and low-contrast "tone-on-tone" companions (ΔE 8–18) — simple combinatorial scoring over ≤30 species, brute force is fine.
6. Rendering colors always come from the species' `displayHex`/`textureTint` so preview ≈ reality; show the Lab range ("walnut varies from … to …") to set expectations.

---

## 8. Outputs

### 8.1 Blueprint (SVG → PDF)

Compose a multi-page PDF, letter + A4:
- **Page 1 — Finished board:** top view to scale (auto scale factor shown, e.g. 1:3), overall dims with dimension lines (arrowed extension lines, fraction labels), thickness callout, species legend with swatches, pattern name, project metadata.
- **Page 2 — Glue-up #1 diagram:** slab cross-section, every strip labeled (species letter + width), rip schedule table.
- **Page 3 — Crosscut & arrangement:** slab with numbered cut lines (angle noted), then slice arrangement diagram showing per-slice flip/rotate icons.
- **Page 4 — Cut list & materials** (tables from §7).
- **Page 5 (if CNC/outline):** outline drawing with radii/center coordinates, juice-groove path with offset dimension, engraving placement.
- Implementation: build SVG in `exports/blueprint/` from the cell grid + dimension-line helper (`dim(x0,y0,x1,y1,label,offset)`); convert via `svg2pdf.js`. Dimension helper must support horizontal/vertical/aligned (for angles) modes.

### 8.2 Procedural Instructions (no LLM)

`exports/instructions.ts` walks the construction pipeline and emits numbered steps from **string templates with computed values** — the same way a compiler emits code:

```
Step 3. Set your miter gauge to 45°. Crosscut the slab into 14 parallelogram
slices, each 1-13/16" wide measured perpendicular to the cut. Your blade will
consume 1/8" per cut; the slab includes 2-1/4" of extra length for this plus
end trimming.
```

Template rules fire off pipeline facts (angled? → miter-gauge step + safety note about angled crosscuts on end grain; endGrain? → "never plane end grain without sacrificial edge or drum sander" warning; flipAlternate? → flip-numbering step). This is a rules engine over ~25 templates — fully deterministic, and unit-testable by snapshot.

### 8.3 CNC Module (`engine/cnc/`)

**Scope:** 2.5D operations only — the honest match for cutting boards.

Operations (user enables per-project; each has its own tool + feeds):
1. **Perimeter profile** — outline polygon, offset **outward by tool radius** (Clipper2 inflate, round joins), multi-pass depth ramping (`stepdown`, default 0.2 × tool Ø), **holding tabs** (user count/size, default 4 tabs 3/8" × 0.15" tall) implemented by raising Z over tab spans, climb vs conventional toggle, lead-in arc.
2. **Juice groove** — outline offset **inward** by user margin (default 3/4"), cut with ball-nose or core-box bit; single-pass-per-depth spiral of the closed path; depth default 3/16" in 2 passes.
3. **Handle recess / thumb scoops** — stadium-shaped pocket: offset-inward contour-parallel pocketing (successive Clipper2 insets by `stepover = 0.4 × tool Ø` until degenerate), zigzag fallback.
4. **Engraving (V2)** — text via **Hershey single-line fonts** (bundled JSON polylines — public domain, deterministic) traced at fixed depth with V-bit; optional true V-carve is out of scope (note in docs).

**Pipeline:** `Outline/paths → offset (tool comp) → depth passes → linearize arcs (tolerance 0.001") → emit`.

**G-code emitter:**
- Dialect: plain RS-274 subset that GRBL, Mach, LinuxCNC all accept: `G20/G21, G90, G17, G0/G1/G2/G3, M3 S…, M5, M2`. Arcs emitted as `G2/G3` with `I,J` when the source is a true arc (rounded rect corners, fillets); polylines otherwise.
- Machine profile object: `{units, safeZ, travelZ, spindleRPM, feedXY, feedZ, useArcs, postHeader[], postFooter[]}` with presets "GRBL (generic hobby router)", "Shapeoko/X-Carve", "Onefinity", "LinuxCNC".
- **Feeds/speeds presets per (bit, hardwood)** shipped as data with a visible disclaimer ("starting points — verify for your machine"); chipload-based calculator: `feed = RPM × flutes × chipload`, hardwood chipload table 0.001–0.013" by bit diameter.
- Safety invariants (unit-tested): first motion is `G0` to safeZ; no `G1` below material top without preceding plunge feed; program ends spindle-off at safeZ; total depth never exceeds stock thickness − 0.05" unless "through-cut" (then exactly thickness + 0.02" onto spoilboard, noted).
- **Built-in visualizer:** render toolpath polylines over the board SVG, color by depth, with rapid moves dashed — reuse `gcode-toolpath`-style parsing of our own output as a self-check (parse what we emit, assert geometry round-trips within tolerance — great integration test).

**DXF/SVG export** of the same paths (flat, layer-per-operation) so users of VCarve/Fusion/Carbide Create can post-process in their own CAM if preferred. DXF writer: R12 ASCII with `LWPOLYLINE`/`LINE`/`ARC`, units header.

---

## 9. Validation & Manufacturability Lint (`engine/validate/`)

Run on every edit; surface as ⚠ warnings (yellow) and ✖ errors (red, block export):

| Rule | Level | Check |
|---|---|---|
| Impossible geometry | ✖ | slice width ≤ 0, θ outside 20–90°, shift > row width, outline exceeds blank |
| Strip too thin | ⚠ | finished strip width < 1/4" (fragile) or < kerf (nonsensical → ✖) |
| Cross-grain glue | ⚠ | designs mixing long-grain orientation in one lamination (wood movement); computed from construction kind |
| Movement mismatch | ⚠ | adjacent species tangential-shrinkage delta > 3% in wide laminations |
| Open-pore species | ⚠ | porosity=open used >15% of area ("harbors moisture; consider sealing or swap") |
| Softwood / silica | ⚠ | janka < 900 ("scars"), bamboo/teak note ("dulls knives") |
| Not food-safe flag | ⚠ | species with cautions in cutting surface (vs. handle/frame zones) |
| Slice count sanity | ⚠ | > 60 slices ("consider thicker stock") |
| Board too thin for groove | ✖ | grooveDepth > 0.4 × finished thickness |
| Tabs vs cutter | ✖ | tab width < tool Ø × 1.5 |
| Rounding drift | ⚠ | Σ rounding error > kerf/2 |

Each rule links to a one-paragraph "why" doc (static markdown in-app).

---

## 10. UI Plan

**Layout:** left = layer/pattern panel, center = canvas with view tabs (Top / End / Slab / 3D / CNC), right = inspector (selected strip/slice/species), bottom = live totals bar (finished W×L×T, BF per species, est. cost, warning count).

Key interactions:
1. **Template gallery** on new project → instant editable board.
2. **Layer stack editor:** drag-reorder strips, inline width edit (accepts `1 3/4`, `1.75`, `44mm`), duplicate, repeat-group creation, species swatch click → species picker with recommender tab.
3. **Slice arranger:** thumbnail row of slices; click to flip/rotate individual slices (sets `sequence` transform); "auto" buttons for the named transforms.
4. **Species picker:** two tabs — *Browse* (filter chips: food-safe, Janka slider, price, in-inventory) and *Match a color* (§7.5 flow).
5. **Inventory manager:** table of owned lumber; feeds the recommender filter and (V2) the stock optimizer.
6. **Board setup:** dimensions, thickness, kerf, allowances, units toggle (persisted), outline picker.
7. **Export drawer:** Blueprint PDF, Cut list CSV, Instructions PDF, Project JSON, SVG, DXF, G-code (per-operation files + combined) — CNC exports gated behind a machine-profile setup modal on first use.
8. **Undo/redo** (Ctrl+Z), autosave to localStorage every mutation (debounced), "Projects" home listing saved designs.
9. Accessibility: full keyboard nav on the layer editor; color-blind-safe pattern option (species also get letter labels in preview toggle).

Rendering details: preview cells get a subtle procedural grain (2-tone linear gradient + low-alpha noise stripes seeded per cell — deterministic seed = cell index) so adjacent same-species cells read as separate pieces, which matters for checkerboards.

---

## 11. Persistence & File Format

- `.cbproj` = versioned JSON: `{formatVersion, board, inventory?, cncOptions, ui: {units}}`. Include `formatVersion: 1` and a migration map from day one.
- Save via download / File System Access API when available; load via file input + drag-drop.
- Autosave: localStorage keyed by project UUID; "recover unsaved work" on launch.
- CSV export of cut list (Excel-friendly, quoted fractions as text).

---

## 12. Testing Plan (write these WITH each engine module, not after)

1. **Golden cases** (from published calculators/examples — encode as fixtures):
   - 18" long end-grain board from 3/4" stock, 1-1/4" final thickness, 1/8" kerf → 24 slices, ≥33" slab (classic worked example).
   - Edge-grain: 12 strips × 1-1/4" + 11 kerfs + 1/4" cleanup → raw width check.
   - Board feet: (rough T+1/4)×(rough W+1/4)×L/144 with 20% waste — match reference calculator outputs.
2. **Property tests** (fast-check):
   - Area conservation: Σ cell areas == slab area used − kerf area − trims (exact integers).
   - Pipeline inverse: cut list rebuilt from grid == original cut list.
   - Transforms are involutions/permutations (flip∘flip = id; shift by row width = id).
   - Chevron: rendered stripe angle == θ within 1e-9 after nm-integer math.
3. **CIEDE2000:** all 34 Sharma reference pairs to 1e-4.
4. **G-code safety invariants** (§8.3) fuzzed across random boards; round-trip parse-back geometry check.
5. **Snapshot tests:** instructions text, blueprint SVG structure, DXF output for canonical projects.
6. **UI smoke tests** (Playwright, optional): create-from-template → edit width → export PDF succeeds.

---

## 13. Build Phases for Claude Code (with acceptance criteria)

**Phase 1 — Engine foundation (no UI).** `units.ts`, types, edge-grain pipeline, cut list for edge grain, tests. ✔ All Phase-1 tests green; `demo.ts` prints a correct cut list for a striped board.

**Phase 2 — End-grain + transforms.** Crosscut math (square + angled), slice transforms, cell grid, golden cases incl. 24-slice example and chevron waste triangles. ✔ Property tests pass.

**Phase 3 — App shell + 2D editor.** Vite/React/Zustand, layer editor, canvas top/end views rendered from cell grid, live totals, undo/autosave, units toggle, templates (stripes, checkerboard, chevron, brick). ✔ Design a checkerboard end to end; refresh restores state.

**Phase 4 — Species DB + recommender + inventory.** species.json (30 entries), Lab/ΔE2000 module + tests, picker UI, inventory screen, lint rules subset (softwood, food-safe, porosity). ✔ "Match a color" returns sensible ranked list; inventory filter works.

**Phase 5 — Exports v1.** Blueprint SVG/PDF, cut-list CSV, procedural instructions, `.cbproj` save/load. ✔ Printed PDF of the checkerboard is dimensionally correct at stated scale (measure!).

**Phase 6 — Outlines + clipping.** Rounded rect / ellipse / paddle, grid clipping in preview, blank-size validation, blueprint outline page. ✔ Paddle board previews and exports correctly.

**Phase 7 — CNC.** Offsetting, profile w/ tabs, juice groove, pocket, machine profiles, G-code emitter + safety tests + visualizer, DXF/SVG export. ✔ Emitted G-code passes invariants and renders correctly in the visualizer AND in an external viewer (e.g. ncviewer) — document manual verification.

**Phase 8 — V2 patterns + polish.** Pinwheel, basket weave, tumbling blocks, 3D preview, stock optimizer (first-fit-decreasing 1D packing onto inventory), Hershey engraving, single-file build. ✔ All templates functional; `dist/` runs from `npx serve`.

Each phase ends with: run full test suite, update `docs/`, commit.

---

## 14. Risks & Decisions Log (for Claude Code to honor)

- **No LLMs, no network calls at runtime.** All "generation" (instructions, recommendations, patterns) is rules + math + data.
- **Kerf/allowance visibility over cleverness:** always show the assumptions; never hide a fudge factor.
- **Species color truthfulness:** wood varies; always display range, never promise exact color.
- **CNC liability:** feeds/speeds are labeled as starting points; G-code always previewed before export; docs include an "air-cut first" checklist.
- **Precision:** integer nanometers everywhere in the engine; the only float math is color science and rendering.
- **Rounding policy:** cut list rounds to 1/32" (display), exact value retained; cumulative drift linted.
