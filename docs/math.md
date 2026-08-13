# Math notes

Everything the app shows comes out of one pure function, `runPipeline(board)` in
`src/engine/construction/pipeline.ts`. This document records the conventions it encodes so a
woodworker (or a future maintainer) can audit them.

## Units

Dimensions are integer **nanometers**. `1 in = 25_400_000 nm` and `1 mm = 1_000_000 nm`, both exact.
Every imperial fraction down to 1/64″ is an integer (`1/64 in = 396_875 nm`), so strip widths,
kerfs, and slab lengths never accumulate float error. A 1 m board is ~1e9 nm, far inside
`Number.MAX_SAFE_INTEGER`.

Angled constructions are the one place a float enters the geometry: a slice cut at θ carries a
`scale = 1/sin θ` and `shear = ±cot θ` that are applied **at render time only**. The cell
boundaries themselves stay exact integers in slab space.

## Stage A — rip and glue-up #1

Strips are expanded from layer groups (`repeat × [strips]`) into a flat ordered list.

```
slabWidth      = Σ stripWidth
slabLength     = (downstream need) + cleanup.lengthTrim
rawWidthNeeded = Σ stripWidth + (n − 1)·kerf + cleanup.widthTrim     [per species]
```

The `n − 1` kerf convention counts the cuts *between* strips; the extra `widthTrim` covers the
jointed edge and the final cleanup rip. Board feet are computed on **rough** stock:

```
roughT     = stockThickness + (roughStock ? 1/4″ : 0)
roughW     = stripWidth     + (roughStock ? 1/4″ : 0)
boardFeet  = Σ (roughT_in × roughW_in × length_in / 144) × (1 + wasteFactor)
```

## Stage B — crosscut

### Square (θ = 90°)

Slices are stood on end, so the crosscut width becomes the finished thickness:

```
sliceWidth = finishedThickness + cleanup.planingLoss
T₁eff      = stockThickness − cleanup.planingLoss      (slab flattened after glue-up #1)
sliceCount = ceil(targetLength / T₁eff)
slabLength = sliceCount·(sliceWidth + kerf) + cleanup.lengthTrim
```

Worked check (`tests/pipeline.test.ts`): an 18″ board from 3/4″ slab stock at 1-1/4″ finished
thickness with a 1/8″ kerf gives **24 slices** and a **33-1/2″ slab** — the classic forum example.

### Angled (chevron / herringbone)

Angled slices stay face-up, so the band width is a design choice and thickness survives both
flattenings:

```
thickness       = stockThickness − 2·planingLoss
rowHeight       = sliceWidth
advancePerSlice = (sliceWidth + kerf) / sin θ
endWaste        = slabWidth · |cot θ|          (triangular offcut where the first cut enters)
slabLength      = sliceCount·advancePerSlice + endWaste + lengthTrim
```

A stripe of width `w` in the slab appears `w / sin θ` wide measured along the slice, which is why
the maximum finished width is bounded:

```
usableWidth = slabWidth/sin θ − |cot θ|·rowHeight
```

Exceeding it is an error, not a warning — the slices physically cannot span the board.

## Stage C — arrange

Each slice is a 1-D sequence of `{species, u0, u1}` intervals. Transforms are exact operations on
that sequence:

| Op | Effect |
|---|---|
| `reverse` | mirror within the run: `u ↦ run − u`, order reversed. An involution. |
| `mirror` | negate the shear (flip the slice face-down). Forms chevron points. |
| `shift` (square) | crosscut once and move the offcut to the front. **Costs one kerf**, so the run becomes `run − kerf`; straddling cells are split. All rows are trimmed to the shortest, making the board one kerf narrower than the slab. |
| `shift` (angled) | slide along the glue line — no cut, no kerf, just a render offset. |

`flipAlternate` resolves to `reverse` on square slices (checkerboard) and `mirror` on angled ones
(chevron), because those are the operations that produce the named pattern in each case.

For angled work the per-row offsets form a chain, `off_{j+1} = off_j − shear_j·rowHeight`, which
keeps stripe boundaries continuous across every glue line. The pattern window is then centered
within the feasible range so both long edges stay covered; if no such window exists the pipeline
warns rather than silently cropping.

## Stage D — flatten and trim

Thickness loses `planingLoss` per glue-up. Diagonal edge-grain boards are cut from an oversized
striped panel whose bounding box is

```
panelLength = L·cos θ + W·sin θ
panelWidth  = L·sin θ + W·cos θ
```

and the strip stack must be at least `panelWidth` wide, or the pipeline errors.

## Rounding policy

Cut-list dimensions display at 1/32″ (`IN` is divisible by 64, so the rounded value is still an
exact integer nm). Any dimension that does not land on 1/32″ is marked `~` and shown with its exact
decimal. The rounding report sums the absolute errors and warns when the total exceeds `kerf / 2`.

## Invariants under test

- `reverse ∘ reverse = id`; reversed rows still tile `[0, run]` exactly.
- Cyclic shift moves exactly `by` to the front, loses exactly one kerf, and leaves no gaps.
- Σ cell areas = slabWidth × assembled length, in exact integers, across all square transforms.
- Every row carries the same multiset of `(species, width)` intervals as the strip stack — the cut
  list rebuilt from the grid equals the original (pipeline inverse).
- Rendered stripe angle equals θ to 1e-9 for every angle in 25–89°.
- CIEDE2000 matches all 34 Sharma et al. reference pairs to 1e-4.

## 2-D block assembly (V2)

Row/interval algebra covers everything you can build by ripping, crosscutting, and flipping
slices. Three patterns cannot be expressed that way, so they emit explicit polygons
(`CellGrid.polys`) and their cut lists count **pieces** rather than strips and slices:

| Pattern | Tiling | Cut list |
|---|---|---|
| Pinwheel | 3u square: four `u × 2u` arms rotating around a `u` hub; adjacent units swap species | pieces, by size |
| Basket weave | n slats per unit, units alternating horizontal/vertical in a checkerboard | one slat size |
| Tumbling blocks | Rhombille: three 60°/120° rhombi meeting at each hexagon centre, one species per orientation | strips `s·sin60` wide, crosscut at 60° every `s` |

All three are glued up as flat panels — pieces cut to size, dry-fitted, then glued in sections.
Tests assert each field tiles its rectangle exactly (total polygon area equals `L × W` to within
1e-6 relative), which catches gaps and overlaps that would be invisible in a preview.

## Outline offsetting (CNC)

`offsetRing` walks the flattened ring, offsets each edge along its outward normal, then:

- **convex corner, offsetting away from it** → arc over the gap at radius `|delta|`
- **everything else** (convex inward, reflex either way) → miter at the intersection of the two
  offset edges

Self-intersection loops are removed by discarding points that end up closer to the source ring
than `|delta|` — reliable because the ring is densified to 1/32″ segments first. Invariants under
test: every offset point sits at `|delta|` from the source (±2%), inward offsets stay inside,
offsetting a circle by `d` gives a concentric circle of radius `r + d`, and an inward offset larger
than the shape collapses to empty rather than inverting.
