/**
 * Procedural build instructions (§8.2).
 *
 * The steps themselves now live in `stages.ts`, because the on-screen stage
 * timeline has to show exactly the same sequence — including the same glue-up
 * count. This module is the markdown/plain-text renderer over that plan.
 */

import type { UnitMode } from '../engine/units';
import type { BoardSpec, PipelineResult } from '../engine/construction/types';
import type { CutList, SpeciesInfoLookup } from '../engine/cutlist/cutlist';
import { buildPlan, type BuildPlan, type BuildStage } from './stages';

export interface InstructionStep {
  n: number;
  title: string;
  body: string;
  safety?: string;
  glueUp?: number;
}

export interface Instructions {
  title: string;
  intro: string;
  steps: InstructionStep[];
  glueUps: number;
  cuttingStages: number;
}

export function generateInstructions(
  board: BoardSpec,
  result: PipelineResult,
  cutlist: CutList,
  speciesInfo: SpeciesInfoLookup,
  units: UnitMode = 'in-frac',
): Instructions {
  const plan: BuildPlan = buildPlan(board, result, cutlist, speciesInfo, units);
  return {
    title: plan.title,
    intro: plan.intro,
    glueUps: plan.glueUps,
    cuttingStages: plan.cuttingStages,
    steps: plan.stages.map((s: BuildStage) => ({
      n: s.index,
      title: s.title,
      body: s.body,
      safety: s.safety,
      glueUp: s.glueUp,
    })),
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
