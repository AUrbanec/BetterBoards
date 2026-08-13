# `.cbproj` file format

A BetterBoards project is a single UTF-8 JSON file. It is plain data — integers and strings — with
no executable content and no references to anything outside itself.

## Envelope

```jsonc
{
  "formatVersion": 1,
  "kind": "betterboards-project",   // required marker; foreign files are rejected
  "savedAt": "2026-08-13T12:00:00.000Z",
  "id": "proj-m4x2p1-9k3",
  "name": "Checkerboard",
  "board": { /* BoardSpec — see below */ },
  "inventory": [ /* InventoryItem[] */ ],
  "ui": { "units": "in-frac" }       // "in-frac" | "in-dec" | "mm"
}
```

All dimensions are **integer nanometers** (1″ = 25,400,000). See [`math.md`](./math.md).

## `board` (BoardSpec)

```jsonc
{
  "name": "Checkerboard",
  "construction": { /* see below */ },
  "targetLength": 457200000,        // finished length (slice-stacking axis for end grain)
  "targetWidth": 0,                 // used by angled/diagonal builds; 0 = derive from the stack
  "stockThickness": 41275000,       // milled thickness entering glue-up #1
  "finishedThickness": 31750000,    // drives slice width for square end grain
  "kerf": 3175000,                  // 1/8"
  "cleanup": {
    "widthTrim": 6350000,           // 1/4"  edge cleanup per source board
    "lengthTrim": 12700000,         // 1/2"  end trim
    "planingLoss": 3175000          // 1/8"  thickness lost per glue-up flattening
  },
  "wasteFactor": 0.2,               // fractional; 0.2 = 20%
  "roughStock": true,               // true adds 1/4" jointing allowances to board feet
  "patternOffset": 0                // shifts the visible window on angled/diagonal patterns
}
```

## `board.construction`

Edge grain:

```jsonc
{
  "kind": "edgeGrain",
  "layers": [ { "strips": [ { "species": "hard-maple", "width": 31750000 } ], "repeat": 4 } ],
  "diagonalAngleDeg": 45            // optional; omit or 0 for straight stripes
}
```

End grain:

```jsonc
{
  "kind": "endGrain",
  "layers": [ /* same shape — defines the slice pattern */ ],
  "crosscut": {
    "angleDeg": 90,                 // 90 = square; 20–89 = angled (chevron/herringbone)
    "sliceWidth": 44450000          // angled only: visible band width
  },
  "transform": { "kind": "flipAlternate" },
  "sliceCountOverride": 12          // optional explicit override of the derived count
}
```

### `transform`

One of:

```jsonc
{ "kind": "none" }
{ "kind": "flipAlternate" }                          // checkerboard (square) / chevron (angled)
{ "kind": "rotate180Alternate" }
{ "kind": "reverseAlternate" }
{ "kind": "shift", "by": 25400000, "alternate": true }
{ "kind": "sequence", "ops": [ {}, { "mirror": true, "shift": 25400000 } ] }
```

A `sequence` is the fully explicit per-slice list the slice arranger writes. Its `ops` cycle if
shorter than the slice count. Each op may set `reverse`, `mirror`, and/or `shift` (nm).

## `inventory`

```jsonc
[ { "species": "hard-maple", "boardFeet": 12, "thickness": 22225000, "pricePerBF": 8.5, "notes": "" } ]
```

`pricePerBF` overrides the species-database default in cost estimates. `thickness` and `notes` are
optional.

## Species ids

`species` values are ids from `src/data/species.json` (e.g. `hard-maple`, `black-walnut`,
`purpleheart`). An unknown id still loads — it renders with a neutral swatch and is skipped by lint
rules — so projects survive database edits.

## Versioning and migrations

`formatVersion` starts at 1. `src/exports/project.ts` holds a `MIGRATIONS` map keyed by source
version; each entry upgrades a raw object by one step, and `parseProject` applies them in sequence.

- A file with a **higher** version than the build supports is rejected with a clear message rather
  than partially read.
- A missing `kind` marker is rejected — this is what distinguishes a project from arbitrary JSON.
- Missing `inventory`, `ui`, `id`, or `name` are filled with defaults rather than failing.

## Autosave

The app also writes the same JSON to `localStorage` under `bb:project:<id>`, with an index at
`bb:projects` and the last-opened id at `bb:last`. Autosave is debounced (400 ms) and best-effort:
if storage is full or blocked, editing continues uninterrupted and only the autosave is skipped.
Exported `.cbproj` files are the durable copy.
