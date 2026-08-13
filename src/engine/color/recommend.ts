/**
 * Species recommendation engine (§7.5): pure color science + curated flags.
 * The app advises, never blocks — filters are suggestions the user can lift.
 */

import { deltaE2000, matchBadge, type Lab, type MatchBadge } from './color';

export interface CandidateSpecies {
  id: string;
  colorLab: Lab;
  janka_lbf: number;
  foodSafe: boolean;
  porosity: 'closed' | 'semi' | 'open';
  pricePerBF: number;
}

export interface RecommendFilters {
  foodSafeOnly: boolean;      // default ON
  jankaMin: number;           // default 900
  jankaMax: number;           // default 1500
  /** Accent mode relaxes the Janka ceiling (purpleheart/padauk/etc. as ≤15% stripes). */
  accentMode: boolean;
  closedGrainOnly: boolean;   // excludes open-pore species (semi allowed)
  maxPricePerBF?: number;
  /** Restrict to the user's inventory. */
  inventoryIds?: ReadonlySet<string>;
}

export const DEFAULT_FILTERS: RecommendFilters = {
  foodSafeOnly: true,
  jankaMin: 900,
  jankaMax: 1500,
  accentMode: false,
  closedGrainOnly: false,
};

export interface RankedSpecies {
  id: string;
  deltaE: number;
  badge: MatchBadge;
}

export function passesFilters(s: CandidateSpecies, f: RecommendFilters): boolean {
  if (f.foodSafeOnly && !s.foodSafe) return false;
  const jankaMax = f.accentMode ? Math.max(f.jankaMax, 3600) : f.jankaMax;
  if (s.janka_lbf < f.jankaMin || s.janka_lbf > jankaMax) return false;
  if (f.closedGrainOnly && s.porosity === 'open') return false;
  if (f.maxPricePerBF !== undefined && s.pricePerBF > f.maxPricePerBF) return false;
  if (f.inventoryIds && !f.inventoryIds.has(s.id)) return false;
  return true;
}

/** Rank all passing species by ΔE2000 to the target color, ascending. */
export function recommendSpecies(
  target: Lab,
  candidates: CandidateSpecies[],
  filters: RecommendFilters = DEFAULT_FILTERS,
): RankedSpecies[] {
  return candidates
    .filter((s) => passesFilters(s, filters))
    .map((s) => {
      const dE = deltaE2000(target, s.colorLab);
      return { id: s.id, deltaE: dE, badge: matchBadge(dE) };
    })
    .sort((a, b) => a.deltaE - b.deltaE);
}

export interface CompanionSuggestion {
  id: string;
  /** min pairwise ΔE against the current species set. */
  minDeltaE: number;
}

/**
 * Palette suggestions given the design's current species:
 *  - 'contrast': maximize the minimum pairwise ΔE (bold companions)
 *  - 'tone': tone-on-tone companions with min ΔE in [8, 18]
 */
export function suggestCompanions(
  currentLabs: Lab[],
  candidates: CandidateSpecies[],
  filters: RecommendFilters,
  mode: 'contrast' | 'tone',
  excludeIds: ReadonlySet<string> = new Set(),
): CompanionSuggestion[] {
  const scored: CompanionSuggestion[] = [];
  for (const s of candidates) {
    if (excludeIds.has(s.id)) continue;
    if (!passesFilters(s, filters)) continue;
    if (currentLabs.length === 0) {
      scored.push({ id: s.id, minDeltaE: 0 });
      continue;
    }
    const minDE = Math.min(...currentLabs.map((l) => deltaE2000(l, s.colorLab)));
    scored.push({ id: s.id, minDeltaE: minDE });
  }
  if (mode === 'contrast') {
    return scored.sort((a, b) => b.minDeltaE - a.minDeltaE).slice(0, 8);
  }
  return scored
    .filter((s) => s.minDeltaE >= 8 && s.minDeltaE <= 18)
    .sort((a, b) => Math.abs(a.minDeltaE - 13) - Math.abs(b.minDeltaE - 13))
    .slice(0, 8);
}
