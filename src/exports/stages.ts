/**
 * Build stages — the single source of truth for "what do I actually do, in what
 * order, and how many glue-ups is this?".
 *
 * Both the written instructions and the on-screen stage timeline render from
 * this one list, so the UI can never claim a different number of glue-ups than
 * the printed steps. Every stage is derived from pipeline facts; nothing here
 * is inferred.
 */

import { formatCutDim, formatDim, type UnitMode } from '../engine/units';
import { isPlainRect } from '../engine/geometry/outline';
import type { BoardSpec, PipelineResult } from '../engine/construction/types';
import type { CutList, SpeciesInfoLookup } from '../engine/cutlist/cutlist';
import { formatSliceList, speciesLetters } from './shared';

export type StageKind =
  | 'mill'
  | 'rip'
  | 'taper'
  | 'cut'
  | 'glue'
  | 'flatten'
  | 'crosscut'
  | 'arrange'
  | 'dryfit'
  | 'shape'
  | 'trim'
  | 'finish';

export interface BuildStage {
  /** 1-based position in the whole build. */
  index: number;
  kind: StageKind;
  title: string;
  body: string;
  safety?: string;
  /** 1-based glue-up counter — set only on `glue` stages. */
  glueUp?: number;
  /** Short label for the timeline chip. */
  short: string;
}

export interface BuildPlan {
  stages: BuildStage[];
  /** How many separate glue-ups this design needs. */
  glueUps: number;
  /** How many machining stages (rip/crosscut/taper/cut/shape/trim). */
  cuttingStages: number;
  intro: string;
  title: string;
}

/** Kinds that involve putting a blade through wood. */
const CUTTING: StageKind[] = ['rip', 'taper', 'cut', 'crosscut', 'shape', 'trim'];

export function buildPlan(
  board: BoardSpec,
  result: PipelineResult,
  cutlist: CutList,
  speciesInfo: SpeciesInfoLookup,
  units: UnitMode = 'in-frac',
): BuildPlan {
  const f = (nm: number) => formatCutDim(nm, units);
  const fd = (nm: number) => formatDim(nm, units);
  const name = (id: string) => speciesInfo(id)?.name ?? id;
  const letters = speciesLetters(board);

  const raw: Omit<BuildStage, 'index'>[] = [];
  let glueUps = 0;
  const add = (
    kind: StageKind,
    short: string,
    title: string,
    body: string,
    safety?: string,
    isGlue = false,
  ) => {
    if (isGlue) glueUps++;
    raw.push({ kind, short, title, body, safety, glueUp: isGlue ? glueUps : undefined });
  };

  const c = board.construction;
  const blocks = c.kind === 'blocks';
  const patch = c.kind === 'patch';
  const curve = c.kind === 'curve';
  const endGrain = c.kind === 'endGrain';
  const angled = c.kind === 'endGrain' && c.crosscut.angleDeg !== 90;
  const diagonal = c.kind === 'edgeGrain' && (c.diagonalAngleDeg ?? 0) !== 0;
  const tapered = result.pieces?.some((p) => p.tapered) ?? false;
  /** Constructions assembled from cut pieces rather than ripped strips. */
  const pieceBased = blocks || patch || curve;

  /* ---- 1. stock ---- */
  const stockLines = cutlist.perSpecies
    .map(
      (s) =>
        `• ${name(s.species)}: ${s.boardFeetRough.toFixed(1)} bf rough (${s.stripCount} pieces, raw rip width ${f(s.rawWidthNeeded)})`,
    )
    .join('\n');
  add(
    'mill',
    'Mill',
    'Gather and mill stock',
    `Mill all stock flat and square to ${f(board.stockThickness)} thick. Material needed (includes ${Math.round(
      board.wasteFactor * 100,
    )}% waste factor${board.roughStock ? ' and 1/4″ rough-milling allowances' : ''}):\n${stockLines}`,
  );

  if (pieceBased) {
    /* ---- piece-based constructions ---- */
    const pieceLines = (result.pieces ?? [])
      .map(
        (p) =>
          `• ${p.count} × ${name(p.species)} — ${f(p.w)} × ${f(p.h)}` +
          (p.angleDeg ? ` at ${p.angleDeg}°` : '') +
          (p.tapered ? ' (tapered — cut on a taper jig)' : '') +
          (p.partial ? ' (edge pieces — cut full size and trim after glue-up)' : ''),
      )
      .join('\n');
    const anyAngled = (result.pieces ?? []).some((p) => p.angleDeg);
    add(
      anyAngled ? 'cut' : 'rip',
      'Cut pieces',
      'Cut the pieces',
      `With a ${fd(board.kerf)}-kerf blade, cut every piece to ${f(board.stockThickness)} thick:\n${pieceLines}\n` +
        (result.blockNotes ?? []).join('\n'),
      anyAngled
        ? 'Set the miter gauge once and cut every angled piece from that single setup — the pattern falls apart if the angles drift.'
        : 'Use a stop block so identical pieces really are identical; the pattern shows every inconsistency.',
    );

    // Sub-assemblies come first when the pattern has any (an HST patch is two
    // triangles glued before it is ever a "square").
    const subAssemblies = result.subAssemblies ?? 0;
    const unit = result.subAssemblyLabel ?? 'patch';
    if (subAssemblies > 0) {
      add(
        'glue',
        `Glue-up ${glueUps + 1}`,
        `Glue-up ${glueUps + 1} — the ${unit} sub-assemblies`,
        `${subAssemblies} ${unit}${subAssemblies === 1 ? '' : 's'} in this design are themselves glued from two or more pieces. Glue those first and let them cure — each has to be flat and square before it can join the panel.` +
          (result.patchCell ? ` Trim each finished ${unit} back to ${f(result.patchCell)} square.` : ''),
        `Glue the ${unit} sub-assemblies on a flat caul with wax paper under them. One that cures out of square puts the error into everything it touches.`,
        true,
      );
    }

    add('dryfit', 'Dry fit', 'Dry-fit the field', `Lay the whole ${f(result.finished.length)} × ${f(result.finished.width)} field out dry before any glue goes on. Check the pattern reads correctly and that the rows close up without gaps.`);

    add(
      'glue',
      `Glue-up ${glueUps + 1}`,
      `Glue-up ${glueUps + 1} — ${curve ? 'columns into pairs' : 'rows'}`,
      curve
        ? `Glue the finished columns together in small groups rather than all at once, keeping the curve continuous across each joint. Suggested clamps: ${Math.max(2, cutlist.glue.glueUp1Clamps)}.`
        : `Glue the pieces into rows, not the whole field at once. The joints run in two directions, so a single mass glue-up cannot be clamped square. Suggested clamps per row: ${Math.max(2, cutlist.glue.glueUp1Clamps)}.`,
      'Work in rows or sections. Trying to clamp the whole field at once is the classic way to end up with a panel that will not flatten.',
      true,
    );
    add(
      'glue',
      `Glue-up ${glueUps + 1}`,
      `Glue-up ${glueUps + 1} — join into the panel`,
      curve
        ? `Glue the column groups into the finished panel. Check the curve across every joint before the clamps go on — a column that is a hair proud breaks the line, and that is the one thing the eye catches.`
        : `Once the rows are cured and their edges are jointed straight, glue the rows together into the finished panel. Line the pattern up across every row joint — this is the seam people will look at.`,
      undefined,
      true,
    );
    add(
      'flatten',
      'Flatten',
      'Flatten the panel',
      `Bring the panel to its final ${f(result.finished.thickness)} thickness with a drum sander or a router sled — the grain runs in several directions, so a planer will tear out somewhere no matter which way you feed it.`,
    );
  } else {
    /* ---- strip-based constructions ---- */
    const ripLines = cutlist.ripSchedule
      .map(
        (g) =>
          `• Rip ${g.count} ${g.count === 1 ? 'strip' : 'strips'} of ${name(g.species)} (${letters.get(g.species) ?? '?'}) — ${f(
            g.width,
          )} wide × ${f(g.thickness)} thick × ${f(g.length)} long`,
      )
      .join('\n');

    if (tapered) {
      const taperLines = (result.pieces ?? [])
        .map(
          (p) =>
            `• ${p.count} × ${name(p.species)} — ${f(p.h)} long, tapering ${f(p.w)} → ${f(p.w2 ?? p.w)}`,
        )
        .join('\n');
      add(
        'taper',
        'Taper',
        'Cut the tapered strips',
        `Every strip in this pattern is a taper — that is what turns straight cuts into a curve. Set a taper jig (or a tapering sled with the strip screwed to it) and cut:\n${taperLines}\nCut each strip from stock at least ${f(
          Math.max(...(result.pieces ?? []).map((p) => Math.max(p.w, p.w2 ?? p.w))),
        )} wide so the wide end is fully supported.`,
        'Never taper freehand against the fence. The offcut is a wedge and it will kick; use a jig that carries the workpiece past the blade.',
      );
    } else {
      add(
        'rip',
        'Rip',
        'Rip the strips',
        `With a ${fd(board.kerf)}-kerf blade:\n${ripLines}\nThe raw widths above already include one kerf per cut plus ${fd(
          board.cleanup.widthTrim,
        )} of edge-cleanup allowance.`,
        'Use a push stick for any rip narrower than 6″. Never rip freehand.',
      );
    }

    const order = result.glueUp1.strips.map((s) => letters.get(s.species) ?? '?').join('–');
    add(
      'glue',
      `Glue-up ${glueUps + 1}`,
      `Glue-up ${glueUps + 1} — the slab`,
      `Arrange the strips on edge in this order (left to right):\n${order}\nGlue every mating face, then clamp. Suggested clamps: ${cutlist.glue.glueUp1Clamps} (one every 6–8″), alternating over/under to keep the slab flat. Joint area ≈ ${cutlist.glue.glueUp1JointArea.toFixed(
        0,
      )} in²; have ≈ ${Math.max(1, Math.ceil(cutlist.glue.glueOzEstimate))} fl oz of glue on hand. The slab comes out ${f(
        result.glueUp1.slabWidth,
      )} wide × ${f(result.glueUp1.slabLength)} long.`,
      undefined,
      true,
    );
    add(
      'flatten',
      'Flatten',
      'Flatten the slab',
      `After the glue cures (24 h for full strength), scrape squeeze-out and flatten both faces to ${f(
        result.glueUp1.slabThicknessAfterPlaning,
      )} — the allowances assume ${fd(board.cleanup.planingLoss)} of thickness lost here.`,
    );

    if (endGrain && result.crosscut) {
      const cc = result.crosscut;
      if (!angled) {
        add(
          'crosscut',
          'Crosscut',
          'Crosscut into slices',
          `Crosscut the slab square into ${cc.sliceCount} slices, each ${f(cc.sliceWidth)} wide. Your blade consumes ${fd(
            board.kerf,
          )} per cut; the slab length includes ${f(
            cc.sliceCount * board.kerf + board.cleanup.lengthTrim,
          )} of extra for kerfs and end trimming. Number the slices 1–${cc.sliceCount} in cutting order with chalk.`,
          'Use a crosscut sled or miter gauge with a stop block — never the rip fence alone as a length stop.',
        );
      } else {
        add(
          'crosscut',
          'Crosscut',
          `Crosscut at ${cc.angleDeg}°`,
          `Set your miter gauge to ${cc.angleDeg}° and crosscut the slab into ${cc.sliceCount} parallelogram slices, each ${f(
            cc.sliceWidth,
          )} wide measured perpendicular to the cut. Each slice (with its kerf) advances ${f(
            Math.round(cc.advancePerSlice),
          )} along the slab, and the first cut wastes a ${f(
            Math.round(cc.endWaste),
          )}-long triangle at the slab end — both are in the slab length. Number the slices in cutting order.`,
          'Angled crosscuts want a long auxiliary fence and firm hold-downs — the offcut side can pinch. Cut a test slice from scrap first.',
        );
      }

      const cs = cutlist.crosscut!;
      const arrange: string[] = [`Lay the slices out in order 1–${cc.sliceCount}.`];
      if (cs.reversed.length) arrange.push(`Rotate slices ${formatSliceList(cs.reversed)} end-for-end (180° on the table).`);
      if (cs.mirrored.length)
        arrange.push(
          `Flip slices ${formatSliceList(cs.mirrored)} face-down (roll them over their long edge) — this mirrors the stripe angle and forms the chevron points.`,
        );
      if (cs.shifted.length) {
        const desc = cs.shifted.map((s) => `${s.slice} by ${f(s.by)}`).join(', ');
        arrange.push(
          angled
            ? `Slide slices ${desc} along the glue line before clamping; the overhanging ends are trimmed later.`
            : `Shift slices ${desc}: crosscut the slice once at the marked line and move the offcut to the leading end. Each shifted slice loses one kerf of width; all slices get trimmed to match.`,
        );
      }
      if (!angled) arrange.push('Every slice now stands on end — the end grain faces up.');
      add('arrange', 'Arrange', 'Arrange the slices', arrange.join('\n'));

      add(
        'glue',
        `Glue-up ${glueUps + 1}`,
        `Glue-up ${glueUps + 1} — the board`,
        `Glue the slices face-to-face in the arranged order. Suggested clamps: ${Math.max(
          2,
          cutlist.glue.glueUp2Clamps || 2,
        )}, with flat cauls above and below (waxed or taped so they don't stick) to keep the pattern aligned. Joint area ≈ ${cutlist.glue.glueUp2JointArea.toFixed(
          0,
        )} in².`,
        undefined,
        true,
      );
      add(
        'flatten',
        'Flatten',
        'Flatten the board',
        angled
          ? `Level both faces to the final ${f(result.finished.thickness)} thickness (drum sander, or light planer passes with fresh knives — the surface is face grain at ${cc.angleDeg}°, but interlocked glue lines chip easily).`
          : `Bring the board to its final ${f(result.finished.thickness)} thickness — the slice width included ${fd(
              board.cleanup.planingLoss,
            )} for this.`,
        angled
          ? undefined
          : 'NEVER feed an end-grain board through a thickness planer — it can explode. Use a drum sander, wide-belt sander, or a router flattening sled.',
      );
    }

    if (diagonal && result.diagonalPanel) {
      const p = result.diagonalPanel;
      add(
        'cut',
        'Diagonal',
        'Lay out and cut the diagonal',
        `The glued panel measures ${f(result.glueUp1.slabWidth)} × ${f(p.panelLength)}. Lay out the ${f(
          result.finished.length,
        )} × ${f(result.finished.width)} rectangle rotated ${p.angleDeg}° to the stripes (framing square and a sharp pencil; leave the layout lines proud). Cut just outside the lines at the bandsaw or track saw, then trim to the lines.`,
      );
      add('flatten', 'Flatten', 'Flatten the board', `Level both faces to the final ${f(result.finished.thickness)} thickness.`);
    }
  }

  /* ---- trim ---- */
  add(
    'trim',
    'Trim',
    'Trim to final size',
    `Square the ends and edges to the finished ${f(result.finished.length)} × ${f(
      result.finished.width,
    )}. Take equal nibbles from both sides to keep the pattern centred.`,
    endGrain ? 'Back up every end-grain exit edge with a sacrificial scrap — blowout is guaranteed otherwise.' : undefined,
  );

  /* ---- shape ---- */
  if (!isPlainRect(result.outline)) {
    const o = result.outline;
    let how: string;
    switch (o.kind) {
      case 'rect':
        how = `Mark a ${f(o.cornerRadius)} radius at each corner (a compass, or a can of the right size), then cut and sand to the line.`;
        break;
      case 'ellipse':
        how = `Mark the centre at ${f(o.rx)} × ${f(o.ry)} from one corner, then scribe the ellipse — a trammel, or the two-pins-and-a-loop-of-string method with foci on the long axis.`;
        break;
      case 'paddle':
        how =
          `Lay out the centreline along the length. The body is ${f(o.bodyW)} × ${f(o.bodyH)} with ${f(o.r)} corners; ` +
          `the handle runs ${f(o.handleL)} past the body, ${f(o.handleW)} wide, centred on that line with a ${f(
            Math.round(o.handleW / 2),
          )} radius at its end.`;
        break;
      case 'polygon':
        how = `Transfer the ${o.points.length} outline points from the blueprint's shaping page, connect them, and cut to the line.`;
        break;
    }
    add(
      'shape',
      'Shape',
      'Cut the outline',
      `${how} Cut just outside the line at the bandsaw or with a jigsaw, then flush-trim to a template or sand to the line. The blank you glued up is already the right size — you are only removing waste here.`,
      endGrain ? 'End grain tears out badly on curves. Take light passes, or sand rather than route.' : undefined,
    );
  }

  /* ---- finish ---- */
  add(
    'finish',
    'Finish',
    'Ease, sand, finish',
    `Break all edges (1/8″ roundover or a hand chamfer). Sand 120 → 180 → 220${
      endGrain ? ' (end grain rewards an extra pass at 320 — it will drink finish otherwise)' : ''
    }. Raise the grain with a damp cloth, knock it back, then flood with food-grade mineral oil until it stops absorbing; follow with a board butter (oil + beeswax).`,
  );

  const stages: BuildStage[] = raw.map((s, i) => ({ ...s, index: i + 1 }));
  const cuttingStages = stages.filter((s) => CUTTING.includes(s.kind)).length;
  const dims = `${f(result.finished.length)} × ${f(result.finished.width)} × ${f(result.finished.thickness)}`;

  return {
    stages,
    glueUps,
    cuttingStages,
    title: `Build instructions — ${board.name}`,
    intro:
      `Finished size ${dims}. Kerf assumed ${fd(board.kerf)}. ` +
      `This design needs ${glueUps} glue-up${glueUps === 1 ? '' : 's'} and ${cuttingStages} machining stage${
        cuttingStages === 1 ? '' : 's'
      } — plan the cure time accordingly. All dimensions include the allowances shown in the cut list; audit them there before cutting.`,
  };
}
