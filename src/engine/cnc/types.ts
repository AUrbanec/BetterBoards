/**
 * CNC option types (plan §8.3). Scope is 2.5-D — the honest match for cutting
 * boards: perimeter profile, juice groove, handle pocket, engraving.
 */

import { IN, type Nm } from '../units';

export type ToolShape = 'flat' | 'ball' | 'vbit' | 'corebox';

export interface Tool {
  id: string;
  name: string;
  diameter: Nm;
  flutes: number;
  shape: ToolShape;
  /** Included angle in degrees — v-bits only. */
  vAngleDeg?: number;
}

export interface Feeds {
  rpm: number;
  /** XY feed, nm/min. */
  feedXY: number;
  /** Plunge feed, nm/min. */
  feedZ: number;
  /** Depth of cut per pass. */
  stepdown: Nm;
}

export type Direction = 'climb' | 'conventional';

export interface ProfileOp {
  enabled: boolean;
  tool: Tool;
  feeds: Feeds;
  direction: Direction;
  /** Holding tabs left uncut so the part doesn't break free. */
  tabs: { count: number; width: Nm; height: Nm };
  /** Extra depth past the stock bottom, into the spoilboard. */
  throughDepth: Nm;
  leadInRadius: Nm;
}

export interface GrooveOp {
  enabled: boolean;
  tool: Tool;
  feeds: Feeds;
  /** Inset from the finished edge to the groove centerline. */
  margin: Nm;
  depth: Nm;
}

export interface PocketOp {
  enabled: boolean;
  tool: Tool;
  feeds: Feeds;
  depth: Nm;
  /** Fraction of tool diameter to step over between contour rings. */
  stepover: number;
  /** Stadium-shaped recess placed relative to the board's own bbox. */
  placement: { cx: number; cy: number; w: Nm; h: Nm };
}

export interface EngraveOp {
  enabled: boolean;
  tool: Tool;
  feeds: Feeds;
  text: string;
  depth: Nm;
  /** Cap height. */
  size: Nm;
  /** Center position as a fraction of the board bbox. */
  placement: { cx: number; cy: number };
}

export interface MachineProfile {
  id: string;
  name: string;
  units: 'in' | 'mm';
  safeZ: Nm;
  travelZ: Nm;
  useArcs: boolean;
  postHeader: string[];
  postFooter: string[];
}

export interface CncOptions {
  machine: MachineProfile;
  /** Stock thickness the toolpaths are cut from (defaults to finished thickness). */
  stockThickness: Nm;
  profile: ProfileOp;
  groove: GrooveOp;
  pocket: PocketOp;
  engrave: EngraveOp;
}

/* ---------------- shipped defaults ---------------- */

export const TOOLS: Tool[] = [
  { id: 'em-250', name: '1/4″ flat end mill', diameter: IN / 4, flutes: 2, shape: 'flat' },
  { id: 'em-375', name: '3/8″ flat end mill', diameter: (IN * 3) / 8, flutes: 2, shape: 'flat' },
  { id: 'em-125', name: '1/8″ flat end mill', diameter: IN / 8, flutes: 2, shape: 'flat' },
  { id: 'ball-250', name: '1/4″ ball nose', diameter: IN / 4, flutes: 2, shape: 'ball' },
  { id: 'corebox-500', name: '1/2″ core box', diameter: IN / 2, flutes: 2, shape: 'corebox' },
  { id: 'v-60', name: '60° V-bit', diameter: IN / 2, flutes: 2, shape: 'vbit', vAngleDeg: 60 },
];

export const toolById = (id: string): Tool => TOOLS.find((t) => t.id === id) ?? TOOLS[0];

/**
 * Chipload table for hardwood, by tool diameter (inches → in/tooth).
 * Published starting points — the UI labels them as such.
 */
const CHIPLOAD: [number, number][] = [
  [0.125, 0.004],
  [0.25, 0.008],
  [0.375, 0.011],
  [0.5, 0.013],
];

export function chiploadFor(diameter: Nm): number {
  const d = diameter / IN;
  let best = CHIPLOAD[0];
  for (const row of CHIPLOAD) if (Math.abs(row[0] - d) < Math.abs(best[0] - d)) best = row;
  return best[1];
}

/** feed = RPM × flutes × chipload. Returns nm/min. */
export function suggestedFeed(tool: Tool, rpm: number): number {
  return Math.round(rpm * tool.flutes * chiploadFor(tool.diameter) * IN);
}

export function defaultFeeds(tool: Tool, rpm = 16000): Feeds {
  const feedXY = suggestedFeed(tool, rpm);
  return {
    rpm,
    feedXY,
    feedZ: Math.round(feedXY * 0.4),
    stepdown: Math.round(tool.diameter * 0.2),
  };
}

export const MACHINES: MachineProfile[] = [
  {
    id: 'grbl',
    name: 'GRBL (generic hobby router)',
    units: 'in',
    safeZ: IN,
    travelZ: IN / 4,
    useArcs: true,
    postHeader: [],
    postFooter: [],
  },
  {
    id: 'shapeoko',
    name: 'Shapeoko / X-Carve',
    units: 'in',
    safeZ: IN,
    travelZ: IN / 4,
    useArcs: true,
    postHeader: [],
    postFooter: [],
  },
  {
    id: 'onefinity',
    name: 'Onefinity',
    units: 'in',
    safeZ: IN,
    travelZ: IN / 4,
    useArcs: true,
    postHeader: [],
    postFooter: [],
  },
  {
    id: 'linuxcnc',
    name: 'LinuxCNC',
    units: 'in',
    safeZ: IN,
    travelZ: IN / 4,
    useArcs: true,
    postHeader: ['G64 P0.001'],
    postFooter: [],
  },
];

export const machineById = (id: string): MachineProfile => MACHINES.find((m) => m.id === id) ?? MACHINES[0];

export function defaultCncOptions(finishedThickness: Nm): CncOptions {
  const profileTool = toolById('em-250');
  const grooveTool = toolById('corebox-500');
  const pocketTool = toolById('em-250');
  const vTool = toolById('v-60');
  return {
    machine: MACHINES[0],
    stockThickness: finishedThickness,
    profile: {
      enabled: true,
      tool: profileTool,
      feeds: defaultFeeds(profileTool),
      direction: 'climb',
      tabs: { count: 4, width: (IN * 3) / 8, height: Math.round(IN * 0.15) },
      throughDepth: Math.round(IN * 0.02),
      leadInRadius: IN / 8,
    },
    groove: {
      enabled: false,
      tool: grooveTool,
      feeds: defaultFeeds(grooveTool),
      margin: (IN * 3) / 4,
      depth: (IN * 3) / 16,
    },
    pocket: {
      enabled: false,
      tool: pocketTool,
      feeds: defaultFeeds(pocketTool),
      depth: IN / 4,
      stepover: 0.4,
      placement: { cx: 0.5, cy: 0.5, w: IN * 4, h: IN * 1 },
    },
    engrave: {
      enabled: false,
      tool: vTool,
      feeds: defaultFeeds(vTool, 14000),
      text: '',
      depth: Math.round(IN * 0.03),
      size: IN / 2,
      placement: { cx: 0.5, cy: 0.85 },
    },
  };
}
