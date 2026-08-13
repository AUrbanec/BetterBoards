/**
 * Wood species database access. Lab values are derived from displayHex at load
 * time via the engine's own color module, so preview colors, match scores, and
 * stored data can never disagree (single source of truth).
 */

import raw from './species.json';
import { hexToLab, type Lab } from '../engine/color/color';

export type Porosity = 'closed' | 'semi' | 'open';
export type Availability = 'common' | 'specialty' | 'exotic';

export interface SpeciesRecord {
  id: string;
  commonName: string;
  botanical: string;
  displayHex: string;
  textureTint: [string, string];
  janka_lbf: number;
  foodSafe: boolean;
  notes: string[];
  cautions: string[];
  porosity: Porosity;
  avgPricePerBF_usd: number;
  movement: { tangential: number; radial: number };
  availability: Availability;
  colorLab: Lab;
  colorRangeLab: [Lab, Lab];
}

interface RawSpecies {
  id: string;
  commonName: string;
  botanical: string;
  displayHex: string;
  textureTint: string[];
  janka_lbf: number;
  foodSafe: boolean;
  notes: string[];
  cautions: string[];
  porosity: string;
  avgPricePerBF_usd: number;
  movement: { tangential: number; radial: number };
  availability: string;
}

export const SPECIES: SpeciesRecord[] = (raw as RawSpecies[]).map((r) => ({
  ...r,
  porosity: r.porosity as Porosity,
  availability: r.availability as Availability,
  textureTint: [r.textureTint[0], r.textureTint[1]] as [string, string],
  colorLab: hexToLab(r.displayHex),
  colorRangeLab: [hexToLab(r.textureTint[0]), hexToLab(r.textureTint[1])] as [Lab, Lab],
}));

export const SPECIES_BY_ID: ReadonlyMap<string, SpeciesRecord> = new Map(
  SPECIES.map((s) => [s.id, s]),
);

export function getSpecies(id: string): SpeciesRecord | undefined {
  return SPECIES_BY_ID.get(id);
}

/** Lookup used by the cut-list engine (allows user price overrides). */
export function makeSpeciesInfoLookup(priceOverrides?: Record<string, number>) {
  return (id: string) => {
    const s = SPECIES_BY_ID.get(id);
    if (!s) return undefined;
    const pricePerBF = priceOverrides?.[id] ?? s.avgPricePerBF_usd;
    return { name: s.commonName, pricePerBF };
  };
}
