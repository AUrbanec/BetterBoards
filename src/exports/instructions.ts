/**
 * Procedural build instructions (§8.2). A rules engine over string templates
 * with computed values — deterministic, no inference. Rules fire off pipeline
 * facts (angled? end grain? flipped slices? shifted slices? …).
 */

import { formatCutDim, formatDim, type UnitMode } from '../engine/units';
import { isPlainRect } from '../engine/geometry/outline';
import type { BoardSpec, PipelineResult } from '../engine/construction/types';
import type { CutList, SpeciesInfoLookup } from '../engine/cutlist/cutlist';
import { formatSliceList, speciesLetters } from './shared';

export interface InstructionStep {
  n: number;
  title: string;
  body: string;
  safety?: string;
}

export interface Instructions {
  title: string;
  intro: string;
  steps: InstructionStep[];
}

export function generateInstructions(
  board: BoardSpec,
  result: PipelineResult,
  cutlist: CutList,
  speciesInfo: SpeciesInfoLookup,
  units: UnitMode = 'in-frac',
): Instructions {
  const f = (nm: number) => formatCutDim(nm, units);
  const fd = (nm: number) => formatDim(nm, units);
  const name = (id: string) => speciesInfo(id)?.name ?? id;
  const letters = speciesLetters(board);
  const steps: InstructionStep[] = [];
  let n = 0;
  const add = (title: string, body: string, safety?: string) => {
    steps.push({ n: ++n, title, body, safety });
  };

  const blocks = board.construction.kind === 'blocks';
  const endGrain = board.construction.kind === 'endGrain';
  const angled = endGrain && (board.construction as { crosscut: { angleDeg: number } }).crosscut.angleDeg !== 90;
  const diagonal = board.construction.kind === 'edgeGrain' && (board.construction.diagonalAngleDeg ?? 0) !== 0;

  // 1 — stock
  const stockLines = cutlist.perSpecies
    .map((s) => `• ${name(s.species)}: ${s.boardFeetRough.toFixed(1)} bf rough (${s.stripCount} strips, raw rip width ${f(s.rawWidthNeeded)})`)
    .join('\n');
  add(
    'Gather and mill stock',
    `Mill all stock flat and square to ${f(board.stockThickness)} thick. Material needed (includes ${Math.round(board.wasteFactor * 100)}% waste factor${board.roughStock ? ' and 1/4″ rough-milling allowances' : ''}):\n${stockLines}`,
  );

  if (blocks && result.pieces) {
    // 2-D block assembly: cut every piece, then glue the field up flat.
    const angled = result.pieces.some((p) => p.angleDeg);
    const pieceLines = result.pieces
      .map(
        (p) =>
          `• ${p.count} × ${name(p.species)} — ${f(p.w)} × ${f(p.h)}` +
          (p.angleDeg ? ` at ${p.angleDeg}°` : '') +
          (p.partial ? ' (edge pieces — cut full size and trim after glue-up)' : ''),
      )
      .join('\n');
    add(
      'Cut the pieces',
      `With a ${fd(board.kerf)}-kerf blade, cut every piece to ${f(board.stockThickness)} thick:\n${pieceLines}\n` +
        (result.blockNotes ?? []).join('\n'),
      angled
        ? 'Set the miter gauge once and cut every rhombus from the same setup — the illusion falls apart if the angles drift.'
        : 'Use a stop block so identical pieces really are identical; the pattern shows every inconsistency.',
    );
    add(
      'Dry-fit the field',
      `Lay the whole ${f(result.finished.length)} × ${f(result.finished.width)} field out dry before any glue goes on. Check that the pattern reads correctly and that the rows close up without gaps.`,
    );
    add(
      'Glue up in sections',
      `Glue the field up as a flat panel, in manageable sections rather than all at once — the joints run in two directions, so a single mass glue-up cannot be clamped square. Flatten each section, then join the sections. Clamp with cauls above and below.`,
      'Work in sections. Trying to clamp the whole field at once is the classic way to end up with a panel that will not flatten.',
    );
    add(
      'Flatten the panel',
      `Bring the panel to its final ${f(result.finished.thickness)} thickness with a drum sander or a router sled — the grain runs in several directions, so a planer will tear out somewhere no matter which way you feed it.`,
    );
  }

  // 2 — rip
  if (!blocks) {
  const ripLines = cutlist.ripSchedule
    .map((g) => `• Rip ${g.count} ${g.count === 1 ? 'strip' : 'strips'} of ${name(g.species)} (${letters.get(g.species) ?? '?'}) — ${f(g.width)} wide × ${f(g.thickness)} thick × ${f(g.length)} long`)
    .join('\n');
  add(
    'Rip the strips',
    `With a ${fd(board.kerf)}-kerf blade:\n${ripLines}\nThe raw widths above already include one kerf per cut plus ${fd(board.cleanup.widthTrim)} of edge-cleanup allowance.`,
    'Use a push stick for any rip narrower than 6″. Never rip freehand.',
  );

  // 3 — glue-up #1
  const order = result.glueUp1.strips.map((s) => letters.get(s.species) ?? '?').join('–');
  add(
    'Glue-up #1 — the slab',
    `Arrange the strips on edge in this order (left to right):\n${order}\nGlue every mating face, then clamp. Suggested clamps: ${cutlist.glue.glueUp1Clamps} (one every 6–8″), alternating over/under to keep the slab flat. Total joint area ≈ ${cutlist.glue.glueUp1JointArea.toFixed(0)} in²; have ≈ ${Math.max(1, Math.ceil(cutlist.glue.glueOzEstimate))} fl oz of glue on hand for the whole project. The slab comes out ${f(result.glueUp1.slabWidth)} wide × ${f(result.glueUp1.slabLength)} long.`,
  );

  // 4 — flatten slab
  add(
    'Flatten the slab',
    `After the glue cures (24 h for full strength), scrape squeeze-out and flatten both faces to ${f(result.glueUp1.slabThicknessAfterPlaning)} — the allowances assume ${fd(board.cleanup.planingLoss)} of thickness lost here.`,
  );
  } // end !blocks

  if (endGrain && result.crosscut) {
    const cc = result.crosscut;
    // 5 — crosscut
    if (!angled) {
      add(
        'Crosscut into slices',
        `Crosscut the slab square into ${cc.sliceCount} slices, each ${f(cc.sliceWidth)} wide. Your blade consumes ${fd(board.kerf)} per cut; the slab length includes ${f(cc.sliceCount * board.kerf + board.cleanup.lengthTrim)} of extra for kerfs and end trimming. Number the slices 1–${cc.sliceCount} in cutting order on their faces with chalk.`,
        'Use a crosscut sled or miter gauge with a stop block — never the rip fence alone as a length stop.',
      );
    } else {
      add(
        `Crosscut at ${cc.angleDeg}°`,
        `Set your miter gauge to ${cc.angleDeg}° and crosscut the slab into ${cc.sliceCount} parallelogram slices, each ${f(cc.sliceWidth)} wide measured perpendicular to the cut. Each slice (with its kerf) advances ${f(Math.round(cc.advancePerSlice))} along the slab, and the first cut wastes a ${f(Math.round(cc.endWaste))}-long triangle at the slab end — both are included in the slab length. Number the slices in cutting order.`,
        'Angled crosscuts want a long auxiliary fence and firm hold-downs — the offcut side can pinch. Cut a test slice from scrap first.',
      );
    }

    // 6 — arrange
    const cs = cutlist.crosscut!;
    const arrange: string[] = [`Lay the slices out in order 1–${cc.sliceCount}.`];
    if (cs.reversed.length > 0) {
      arrange.push(`Rotate slices ${formatSliceList(cs.reversed)} end-for-end (180° on the table).`);
    }
    if (cs.mirrored.length > 0) {
      arrange.push(`Flip slices ${formatSliceList(cs.mirrored)} face-down (roll them over their long edge) — this mirrors the stripe angle and forms the chevron points.`);
    }
    if (cs.shifted.length > 0) {
      const desc = cs.shifted.map((s) => `${s.slice} by ${f(s.by)}`).join(', ');
      arrange.push(
        angled
          ? `Slide slices ${desc} along the glue line before clamping; the overhanging ends are trimmed later.`
          : `Shift slices ${desc}: crosscut the slice once at the marked line and move the offcut to the leading end. Each shifted slice loses one kerf of width; all slices get trimmed to match.`,
      );
    }
    if (!angled && board.construction.kind === 'endGrain') {
      arrange.push('Every slice now stands on end — the end grain faces up.');
    }
    add('Arrange the slices', arrange.join('\n'), undefined);

    // 7 — glue-up #2
    add(
      'Glue-up #2 — the board',
      `Glue the slices face-to-face in the arranged order. Suggested clamps: ${Math.max(2, cs.sliceCount > 1 ? cutlist.glue.glueUp2Clamps : 2)}, with flat cauls above and below (waxed or taped so they don't stick) to keep the checkering aligned. Joint area ≈ ${cutlist.glue.glueUp2JointArea.toFixed(0)} in².`,
    );

    // 8 — flatten
    if (!angled) {
      add(
        'Flatten the board',
        `Bring the board to its final ${f(result.finished.thickness)} thickness — the slice width included ${fd(board.cleanup.planingLoss)} for this.`,
        'NEVER feed an end-grain board through a thickness planer — it can explode. Use a drum sander, wide-belt sander, or a router flattening sled.',
      );
    } else {
      add(
        'Flatten the board',
        `Level both faces to the final ${f(result.finished.thickness)} thickness (drum sander or light planer passes with fresh knives — the surface is still face grain at ${cc.angleDeg}°, but interlocked glue lines chip easily).`,
      );
    }
  }

  if (diagonal && result.diagonalPanel) {
    const p = result.diagonalPanel;
    add(
      'Lay out the diagonal',
      `The glued panel measures ${f(result.glueUp1.slabWidth)} × ${f(p.panelLength)}. Lay out the ${f(result.finished.length)} × ${f(result.finished.width)} rectangle rotated ${p.angleDeg}° to the stripes (a framing square and a sharp pencil; leave the layout lines proud). Cut just outside the lines at the bandsaw or track saw, then trim to the lines.`,
    );
    add(
      'Flatten the board',
      `Level both faces to the final ${f(result.finished.thickness)} thickness.`,
    );
  }

  // trim
  add(
    'Trim to final size',
    `Square the ends and edges to the finished ${f(result.finished.length)} × ${f(result.finished.width)}. Take equal nibbles from both sides to keep the pattern centered.`,
    endGrain ? 'Back up every end-grain exit edge with a sacrificial scrap — blowout is guaranteed otherwise.' : undefined,
  );

  // shaping (non-rectangular outlines only)
  if (!isPlainRect(result.outline)) {
    const o = result.outline;
    let how: string;
    switch (o.kind) {
      case 'rect':
        how = `Mark a ${f(o.cornerRadius)} radius at each corner (a compass or a can of the right size works), then cut and sand to the line.`;
        break;
      case 'ellipse':
        how = `Mark the center at ${f(o.rx)} × ${f(o.ry)} from one corner, then scribe the ellipse — a trammel, or the two-pins-and-a-loop-of-string method with foci on the long axis.`;
        break;
      case 'paddle':
        how =
          `Lay out the centerline along the length. The body is ${f(o.bodyW)} × ${f(o.bodyH)} with ${f(o.r)} corners; ` +
          `the handle runs ${f(o.handleL)} past the body, ${f(o.handleW)} wide, centered on that line with a ${f(Math.round(o.handleW / 2))} radius at its end.`;
        break;
      case 'polygon':
        how = `Transfer the ${o.points.length} outline points from the blueprint's shaping page, connect them, and cut to the line.`;
        break;
    }
    add(
      'Cut the outline',
      `${how} Cut just outside the line at the bandsaw or with a jigsaw, then flush-trim to a template or sand to the line. The blank you glued up is already the right size — you are only removing waste here.`,
      endGrain
        ? 'End grain tears out badly on curves. Take light passes, climb-cut the last whisker, or sand rather than route.'
        : undefined,
    );
  }

  // finish
  add(
    'Ease, sand, finish',
    `Break all edges (1/8″ roundover or a hand chamfer). Sand 120 → 180 → 220${endGrain ? ' (end grain rewards an extra pass at 320 — it will drink finish otherwise)' : ''}. Raise the grain with a damp cloth, knock it back, then flood with food-grade mineral oil until it stops absorbing; follow with a board butter (oil + beeswax).`,
  );

  const dims = `${f(result.finished.length)} × ${f(result.finished.width)} × ${f(result.finished.thickness)}`;
  return {
    title: `Build instructions — ${board.name}`,
    intro: `Finished size ${dims}. Kerf assumed ${fd(board.kerf)}. All dimensions include the allowances shown in the cut list; audit them there before cutting.`,
    steps,
  };
}

export function instructionsToMarkdown(ins: Instructions): string {
  const parts = [`# ${ins.title}`, '', ins.intro, ''];
  for (const s of ins.steps) {
    parts.push(`## Step ${s.n} — ${s.title}`, '', s.body, '');
    if (s.safety) parts.push(`> ⚠ ${s.safety}`, '');
  }
  return parts.join('\n');
}
