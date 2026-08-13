/**
 * App state: Zustand store with undo/redo over board edits, debounced
 * localStorage autosave, and project file I/O. The engine stays pure —
 * pipeline results are derived in components via useMemo.
 */

import { create } from 'zustand';
import type { UnitMode } from '../engine/units';
import type { BoardSpec } from '../engine/construction/types';
import { TEMPLATES, TEMPLATE_BY_ID } from '../engine/patterns/templates';
import { parseProject, serializeProject, type InventoryItem } from '../exports/project';

export type ViewTab = 'top' | 'end' | 'slab';
export type SpeciesTab = 'browse' | 'match' | 'inventory';

export interface ProjectMeta {
  id: string;
  name: string;
  savedAt: string;
}

interface HistoryEntry {
  board: BoardSpec;
  name: string;
}

export interface StripSelection {
  group: number;
  strip: number;
}

interface BBState {
  projectId: string;
  name: string;
  board: BoardSpec;
  inventory: InventoryItem[];
  units: UnitMode;
  view: ViewTab;
  speciesTab: SpeciesTab;
  selection: StripSelection | null;
  showLabels: boolean;
  galleryOpen: boolean;
  exportOpen: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];

  updateBoard: (mutate: (draft: BoardSpec) => void, undoable?: boolean) => void;
  replaceBoard: (board: BoardSpec, name?: string) => void;
  undo: () => void;
  redo: () => void;
  setName: (name: string) => void;
  setUnits: (units: UnitMode) => void;
  setView: (view: ViewTab) => void;
  setSpeciesTab: (tab: SpeciesTab) => void;
  select: (sel: StripSelection | null) => void;
  toggleLabels: () => void;
  setGalleryOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  newFromTemplate: (templateId: string) => void;
  newProjectId: () => void;
  loadProjectText: (text: string) => string | null; // returns error message or null
  serializeCurrent: () => string;
  setInventory: (inv: InventoryItem[]) => void;
  loadSaved: (id: string) => boolean;
  deleteSaved: (id: string) => void;
}

const HISTORY_LIMIT = 100;
const LS_PREFIX = 'bb:project:';
const LS_INDEX = 'bb:projects';
const LS_LAST = 'bb:last';

const genId = () => `proj-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

const clone = <T,>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/* ------------- localStorage helpers (best-effort, never throw) ------------- */

function readIndex(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(LS_INDEX);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ProjectMeta[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeIndex(list: ProjectMeta[]): void {
  try {
    localStorage.setItem(LS_INDEX, JSON.stringify(list));
  } catch {
    /* storage full/blocked — autosave is best-effort */
  }
}

export function listSavedProjects(): ProjectMeta[] {
  return readIndex().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function persist(state: BBState): void {
  try {
    const json = serializeProject({
      id: state.projectId,
      name: state.name,
      board: state.board,
      inventory: state.inventory,
      ui: { units: state.units },
    });
    localStorage.setItem(LS_PREFIX + state.projectId, json);
    localStorage.setItem(LS_LAST, state.projectId);
    const index = readIndex().filter((p) => p.id !== state.projectId);
    index.push({ id: state.projectId, name: state.name, savedAt: new Date().toISOString() });
    writeIndex(index);
  } catch {
    /* best-effort */
  }
}

function loadInitial(): { id: string; name: string; board: BoardSpec; inventory: InventoryItem[]; units: UnitMode; fresh: boolean } {
  try {
    const last = localStorage.getItem(LS_LAST);
    if (last) {
      const raw = localStorage.getItem(LS_PREFIX + last);
      if (raw) {
        const p = parseProject(raw);
        return { id: p.id, name: p.name, board: p.board, inventory: p.inventory, units: p.ui.units, fresh: false };
      }
    }
  } catch {
    /* fall through to fresh */
  }
  const board = TEMPLATES[0].build();
  return { id: genId(), name: board.name, board, inventory: [], units: 'in-frac', fresh: true };
}

/* ------------- store ------------- */

const initial = loadInitial();

export const useStore = create<BBState>()((set, get) => ({
  projectId: initial.id,
  name: initial.name,
  board: initial.board,
  inventory: initial.inventory,
  units: initial.units,
  view: 'top',
  speciesTab: 'browse',
  selection: null,
  showLabels: false,
  galleryOpen: initial.fresh,
  exportOpen: false,
  past: [],
  future: [],

  updateBoard: (mutate, undoable = true) => {
    const { board, name, past } = get();
    const draft = clone(board);
    mutate(draft);
    set({
      board: draft,
      past: undoable ? [...past.slice(-HISTORY_LIMIT + 1), { board, name }] : past,
      future: undoable ? [] : get().future,
    });
  },

  replaceBoard: (board, name) => {
    const cur = get();
    set({
      board: clone(board),
      name: name ?? cur.name,
      past: [...cur.past.slice(-HISTORY_LIMIT + 1), { board: cur.board, name: cur.name }],
      future: [],
      selection: null,
    });
  },

  undo: () => {
    const { past, future, board, name } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      board: prev.board,
      name: prev.name,
      past: past.slice(0, -1),
      future: [{ board, name }, ...future].slice(0, HISTORY_LIMIT),
      selection: null,
    });
  },

  redo: () => {
    const { past, future, board, name } = get();
    if (!future.length) return;
    const next = future[0];
    set({
      board: next.board,
      name: next.name,
      future: future.slice(1),
      past: [...past.slice(-HISTORY_LIMIT + 1), { board, name }],
      selection: null,
    });
  },

  setName: (name) => set({ name }),
  setUnits: (units) => set({ units }),
  setView: (view) => set({ view }),
  setSpeciesTab: (speciesTab) => set({ speciesTab }),
  select: (selection) => set({ selection }),
  toggleLabels: () => set({ showLabels: !get().showLabels }),
  setGalleryOpen: (galleryOpen) => set({ galleryOpen }),
  setExportOpen: (exportOpen) => set({ exportOpen }),

  newFromTemplate: (templateId) => {
    const t = TEMPLATE_BY_ID.get(templateId);
    if (!t) return;
    const board = t.build();
    set({
      projectId: genId(),
      name: board.name,
      board,
      past: [],
      future: [],
      selection: null,
      galleryOpen: false,
      view: 'top',
    });
  },

  newProjectId: () => set({ projectId: genId() }),

  loadProjectText: (text) => {
    try {
      const p = parseProject(text);
      set({
        projectId: p.id,
        name: p.name,
        board: p.board,
        inventory: p.inventory,
        units: p.ui.units,
        past: [],
        future: [],
        selection: null,
        galleryOpen: false,
      });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not read the project file.';
    }
  },

  serializeCurrent: () => {
    const s = get();
    return serializeProject({
      id: s.projectId,
      name: s.name,
      board: s.board,
      inventory: s.inventory,
      ui: { units: s.units },
    });
  },

  setInventory: (inventory) => set({ inventory }),

  loadSaved: (id) => {
    try {
      const raw = localStorage.getItem(LS_PREFIX + id);
      if (!raw) return false;
      const p = parseProject(raw);
      set({
        projectId: p.id,
        name: p.name,
        board: p.board,
        inventory: p.inventory,
        units: p.ui.units,
        past: [],
        future: [],
        selection: null,
        galleryOpen: false,
      });
      return true;
    } catch {
      return false;
    }
  },

  deleteSaved: (id) => {
    try {
      localStorage.removeItem(LS_PREFIX + id);
      writeIndex(readIndex().filter((p) => p.id !== id));
    } catch {
      /* ignore */
    }
  },
}));

/* ------------- debounced autosave ------------- */

let saveTimer: ReturnType<typeof setTimeout> | undefined;
if (typeof window !== 'undefined') {
  useStore.subscribe((state, prev) => {
    if (
      state.board !== prev.board ||
      state.name !== prev.name ||
      state.inventory !== prev.inventory ||
      state.units !== prev.units ||
      state.projectId !== prev.projectId
    ) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => persist(useStore.getState()), 400);
    }
  });
}
