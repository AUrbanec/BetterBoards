/**
 * Project persistence (§11): versioned .cbproj JSON with a migration map
 * from day one. Everything in the file is plain data (integer nm + strings).
 */

import type { UnitMode } from '../engine/units';
import type { BoardSpec } from '../engine/construction/types';

export const PROJECT_FORMAT_VERSION = 1;
export const PROJECT_KIND = 'betterboards-project';

export interface InventoryItem {
  species: string;
  boardFeet: number;
  /** milled thickness on hand, inches as nm (optional) */
  thickness?: number;
  pricePerBF?: number;
  notes?: string;
  /** Usable length of one board (nm) — feeds the stock optimizer. */
  boardLength?: number;
  /** How many boards of that length are on hand. */
  boardCount?: number;
}

export interface ProjectFile {
  formatVersion: number;
  kind: typeof PROJECT_KIND;
  savedAt: string;
  id: string;
  name: string;
  board: BoardSpec;
  inventory: InventoryItem[];
  ui: { units: UnitMode };
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** version → migration to the NEXT version. Add entries as the format evolves. */
const MIGRATIONS: Record<number, Migration> = {
  // 1: (raw) => ({ ...raw, formatVersion: 2, newField: defaultValue }),
};

export function serializeProject(p: Omit<ProjectFile, 'formatVersion' | 'kind' | 'savedAt'>): string {
  const file: ProjectFile = {
    formatVersion: PROJECT_FORMAT_VERSION,
    kind: PROJECT_KIND,
    savedAt: new Date().toISOString(),
    ...p,
  };
  return JSON.stringify(file, null, 2);
}

export function parseProject(text: string): ProjectFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  if (raw?.kind !== PROJECT_KIND) {
    throw new Error('Not a BetterBoards project file (missing kind marker).');
  }
  let version = typeof raw.formatVersion === 'number' ? raw.formatVersion : 0;
  if (version > PROJECT_FORMAT_VERSION) {
    throw new Error(
      `This project was saved by a newer BetterBoards (format v${version}); this build reads up to v${PROJECT_FORMAT_VERSION}.`,
    );
  }
  while (version < PROJECT_FORMAT_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new Error(`No migration path from format v${version}.`);
    raw = migrate(raw);
    version = raw.formatVersion as number;
  }
  const p = raw as unknown as ProjectFile;
  if (!p.board || typeof p.board !== 'object' || !p.board.construction) {
    throw new Error('Project file has no board data.');
  }
  if (!Array.isArray(p.inventory)) p.inventory = [];
  if (!p.ui || typeof p.ui !== 'object') p.ui = { units: 'in-frac' };
  if (!p.id || typeof p.id !== 'string') p.id = `proj-${Date.now().toString(36)}`;
  if (typeof p.name !== 'string' || !p.name) p.name = p.board.name || 'Untitled board';
  return p;
}
