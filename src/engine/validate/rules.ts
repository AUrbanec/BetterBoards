/**
 * Manufacturability lint (§9). Warnings advise; errors mark designs that are
 * physically impossible (pipeline errors are folded in as lints too).
 * Every rule carries a one-paragraph "why" for the in-app explainer.
 */

import { IN, formatFraction, type Nm } from '../units';
import { expandLayers, type BoardSpec, type PipelineResult } from '../construction/types';
import { speciesAreas } from '../construction/pipeline';
import type { CutList } from '../cutlist/cutlist';

export interface Lint {
  id: string;
  level: 'error' | 'warning';
  message: string;
  why: string;
}

export interface SpeciesMeta {
  id: string;
  commonName: string;
  janka_lbf: number;
  foodSafe: boolean;
  porosity: 'closed' | 'semi' | 'open';
  cautions: string[];
  movement: { tangential: number; radial: number };
}

export type SpeciesMetaLookup = (id: string) => SpeciesMeta | undefined;

const WHY: Record<string, string> = {
  'strip-lt-kerf':
    'A finished strip narrower than the saw kerf is nonsensical: the blade would consume the entire strip while ripping it. Increase the strip width or use a thinner-kerf blade.',
  'strip-thin':
    'Strips narrower than about 1/4" are fragile to rip safely, prone to cracking during glue-up clamping, and can burn or wander against the fence. Consider ripping oversize pieces and planing to width.',
  softwood:
    'Species below roughly 900 lbf on the Janka scale scar quickly under knife work. The board will still function, but expect deep marks; soft species are better used in serving boards or decorative frames.',
  'hardwood-dulls':
    'Very hard species (above roughly 2000 lbf Janka) are noticeably harder on knife edges. Many makers still use them as accent stripes; a full cutting surface of them is a knife-sharpening commitment.',
  'not-food-safe':
    'This species is commonly advised against for food-contact cutting surfaces (splinter/dust concerns). It remains popular for handles, frames, and decorative zones. The app never blocks a species choice — this is advisory.',
  'species-cautions':
    'Curated cautions for this species (dust sensitizers, open pores, color bleed, etc.). Read them before committing the design.',
  'open-pores':
    'Open-pored species (red oak is the classic example) wick moisture and food juices into their vessels, which harbors bacteria and stains. Keep open-pored species under about 15% of the surface, seal them well, or swap for a closed-grain species.',
  'movement-mismatch':
    'Adjacent species with very different tangential shrinkage rates expand and contract at different rates with humidity. In wide laminations this stresses the glue lines and can telegraph ridges. Deltas above ~3% deserve attention (matched grain orientation, narrower stripes, stable finish).',
  'slice-sanity':
    'More than about 60 slices means a marathon of crosscutting and a very long glue-up. Consider thicker stock (fewer, thicker slices) or a shorter board.',
  'rounding-drift':
    'Cut-list dimensions are shown to the nearest 1/32". Individually the rounding is invisible, but if the accumulated error across the board exceeds half a kerf your final dimension will drift from the drawing. Cut the marked pieces to the exact decimal instead.',
  'endgrain-thin':
    'End-grain boards under about 1" finished thickness are prone to cracking across the glue joints — there is little long-grain continuity to carry stress. 1-1/4" to 1-1/2" is the common range.',
  'shift-kerf':
    'Shifting a slice is done by crosscutting it once and moving the offcut to the other end, which destroys one kerf of width. All slices are trimmed to match the shortest, so the finished board is one kerf narrower than the slab.',
  'angled-coverage':
    'At a miter angle, each slice must be long enough to span the board diagonally. The strip stack (slab width) limits the maximum finished width; add strips, reduce the finished width, or steepen the angle.',
  'cross-grain':
    'Gluing long grain across long grain restricts seasonal wood movement and eventually cracks the panel. Keep all strips in a lamination oriented the same way.',
};

function why(id: string): string {
  return WHY[id] ?? '';
}

export function validateBoard(
  board: BoardSpec,
  result: PipelineResult,
  species: SpeciesMetaLookup,
  cutlist?: CutList,
): Lint[] {
  const lints: Lint[] = [];
  const add = (id: string, level: 'error' | 'warning', message: string) =>
    lints.push({ id, level, message, why: why(id) });

  // Fold in pipeline geometry issues.
  for (const issue of result.issues) {
    lints.push({ id: issue.id, level: issue.level, message: issue.message, why: why(issue.id) });
  }

  const strips = expandLayers(board.construction.layers);
  const quarterInch = Math.round(0.25 * IN);

  // Strip width rules (report each offending width once).
  const seenThin = new Set<Nm>();
  for (const s of strips) {
    if (s.width <= 0) continue;
    if (s.width < board.kerf && !seenThin.has(-s.width)) {
      seenThin.add(-s.width);
      add('strip-lt-kerf', 'error', `A ${formatFraction(s.width)}″ strip is narrower than the kerf (${formatFraction(board.kerf)}″).`);
    } else if (s.width < quarterInch && s.width >= board.kerf && !seenThin.has(s.width)) {
      seenThin.add(s.width);
      add('strip-thin', 'warning', `Strips of ${formatFraction(s.width)}″ are fragile to rip and clamp.`);
    }
  }

  // Species rules — once per species present.
  const used = [...new Set(strips.map((s) => s.species))];
  for (const id of used) {
    const meta = species(id);
    if (!meta) continue;
    if (meta.janka_lbf < 900) {
      add('softwood', 'warning', `${meta.commonName} (Janka ${meta.janka_lbf}) is softer than the usual 900 lbf floor — it will scar easily.`);
    }
    if (meta.janka_lbf > 2000) {
      add('hardwood-dulls', 'warning', `${meta.commonName} (Janka ${meta.janka_lbf}) is very hard and will dull knives faster.`);
    }
    if (!meta.foodSafe) {
      add('not-food-safe', 'warning', `${meta.commonName} is flagged as not recommended for food-contact surfaces.`);
    }
    if (meta.cautions.length > 0) {
      add('species-cautions', 'warning', `${meta.commonName}: ${meta.cautions.join('; ')}.`);
    }
  }

  // Open-pore area share, measured on the *finished* (outline-clipped) surface.
  const { bySpecies: areaBySpecies, total: totalArea } = speciesAreas(result);
  if (totalArea > 0) {
    let openArea = 0;
    for (const [id, a] of areaBySpecies) {
      if (species(id)?.porosity === 'open') openArea += a;
    }
    const share = openArea / totalArea;
    if (share > 0.15) {
      add('open-pores', 'warning', `Open-pored species cover ${(share * 100).toFixed(0)}% of the surface (guideline: ≤15%). They harbor moisture; consider sealing or swapping.`);
    }
  }

  // Movement mismatch between adjacent strips.
  const reported = new Set<string>();
  for (let i = 1; i < strips.length; i++) {
    const a = species(strips[i - 1].species);
    const b = species(strips[i].species);
    if (!a || !b || a.id === b.id) continue;
    const delta = Math.abs(a.movement.tangential - b.movement.tangential);
    const key = [a.id, b.id].sort().join('|');
    if (delta > 3 && !reported.has(key)) {
      reported.add(key);
      add('movement-mismatch', 'warning', `${a.commonName} and ${b.commonName} differ by ${delta.toFixed(1)}% tangential shrinkage — adjacent stripes will fight each other seasonally.`);
    }
  }

  // Slice count sanity & end-grain thickness.
  if (result.crosscut) {
    if (result.crosscut.sliceCount > 60) {
      add('slice-sanity', 'warning', `${result.crosscut.sliceCount} slices is a lot of crosscutting — consider thicker stock.`);
    }
    if (result.crosscut.angleDeg === 90 && result.finished.thickness < IN) {
      add('endgrain-thin', 'warning', `End-grain boards under 1″ finished thickness (${formatFraction(result.finished.thickness)}″) are prone to cracking.`);
    }
  }

  // Rounding drift (from the cut list, when provided).
  if (cutlist?.rounding.driftWarning) {
    add('rounding-drift', 'warning', `Accumulated 1/32″ rounding across the cut list exceeds half a kerf — cut the flagged pieces to their exact decimals.`);
  }

  // De-duplicate identical lints (same id + message).
  const seen = new Set<string>();
  return lints.filter((l) => {
    const key = `${l.id}|${l.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
