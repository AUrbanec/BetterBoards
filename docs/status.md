# Build status

Phase numbering follows [`plan.md`](./plan.md) §13.

## Done — MVP (phases 1–5)

| Phase | Scope | Acceptance |
|---|---|---|
| 1 — Engine foundation | `units.ts`, core types, edge-grain pipeline, cut list | ✅ `npm run demo` prints a correct striped-board cut list |
| 2 — End grain + transforms | Square & angled crosscut math, slice transforms, cell grid | ✅ Golden 24-slice case and chevron waste triangles verified; property tests pass |
| 3 — App shell + 2D editor | Vite/React/Zustand, layer editor, canvas views, undo, autosave, units toggle, templates | ✅ Checkerboard designed end to end in a real browser; reload restores state |
| 4 — Species + recommender | 30-species DB, ΔE2000 module, picker UI, inventory, lint rules | ✅ Color match returns a sensible ranked list; inventory filter and price overrides work |
| 5 — Exports v1 | Blueprint SVG/print, CSV, instructions, `.cbproj` | ✅ Blueprint pages render correctly; 18″ board draws at 6″ on letter at the stated 1:3 |

### Verification

```bash
npm test           # 51 tests: golden cases, fast-check properties, CIEDE2000, lint, exports
npm run typecheck  # strict, clean
npm run build      # clean
node scripts/smoke.mjs /tmp/shots    # 12-step browser flow, no console errors
```

The browser smoke test covers: template gallery → checkerboard → edit a strip width → undo →
slice arranger → cut list → instructions → color match → lint popover → chevron → crosscut view →
export drawer → project download → reload restores autosave.

Blueprint pages were rendered to PNG (`scripts/blueprint-preview.mjs`) and checked visually for
scale, dimension lines, legends, and table fit.

## Not yet built — V2 (phases 6–8)

These are specified in the plan but not implemented. Nothing in the current code blocks them; the
pipeline's grid output is the intended input for all three.

- **Phase 6 — Outlines & clipping.** Rounded rect, ellipse, paddle, custom polygon; clip the cell
  grid against the outline for preview; blank-size validation; outline blueprint page.
  The `Outline` type from plan §4.4 is not yet in the codebase — boards are rectangles today.
- **Phase 7 — CNC.** Clipper2/polygon-clipping offsetting, perimeter profile with tabs, juice
  groove, handle pocket, machine profiles, G-code emitter with safety invariants, toolpath
  visualizer, DXF/SVG per-operation export.
- **Phase 8 — V2 patterns & polish.** Pinwheel, basket weave, tumbling blocks (2-D block assembly —
  an extension of Stage C), three.js 3-D preview, 1-D stock optimizer over inventory, Hershey-font
  engraving, single-file build.

Smaller follow-ups worth noting:

- Drag-to-reorder in the layer stack (buttons work today; the plan asks for drag).
- Color-blind-safe mode beyond the existing species-letter toggle.
- Playwright assertions currently live in `scripts/smoke.mjs`; folding them into `npm test` would
  need a headless-browser test runner setup.
