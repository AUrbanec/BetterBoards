/**
 * G-code emitter (plan §8.3).
 *
 * Dialect: the plain RS-274 subset GRBL, Mach, and LinuxCNC all accept —
 * G20/G21, G90, G17, G0/G1, M3/M5, M2. Arcs are not re-fitted: our paths are
 * already polylines at 0.001″ tolerance, and emitting straight moves means the
 * posted file always matches the preview exactly.
 *
 * Safety invariants (asserted by the emitter itself and by tests):
 *   1. the first motion is a G0 to safe Z
 *   2. every XY rapid happens at or above safe Z
 *   3. no cutting move descends without a preceding feed-rate plunge
 *   4. the program ends spindle-off at safe Z
 *   5. depth never exceeds the declared stock thickness unless it is a
 *      through-cut, and then by the stated overcut only
 */

import { IN, MM, type Nm } from '../units';
import type { Operation, Move } from './toolpath';
import type { CncOptions, MachineProfile } from './types';

export interface GcodeResult {
  text: string;
  lines: number;
  /** Violations found while emitting — non-empty means do not run this file. */
  violations: string[];
}

function fmt(nm: Nm, units: 'in' | 'mm'): string {
  const v = units === 'in' ? nm / IN : nm / MM;
  const s = v.toFixed(units === 'in' ? 4 : 3);
  return s.replace(/\.?0+$/, '') || '0';
}

function feedFmt(nmPerMin: number, units: 'in' | 'mm'): string {
  const v = units === 'in' ? nmPerMin / IN : nmPerMin / MM;
  return v.toFixed(1).replace(/\.0$/, '');
}

/**
 * Emit one operation as a standalone program.
 * `maxCutDepth` is the deepest |z| the file is allowed to reach.
 */
export function emitGcode(op: Operation, cnc: CncOptions, opts: { maxCutDepth: Nm }): GcodeResult {
  const m: MachineProfile = cnc.machine;
  const u = m.units;
  const out: string[] = [];
  const violations: string[] = [];
  const X = (n: number) => fmt(Math.round(n), u);

  out.push(`( BetterBoards — ${op.name} )`);
  out.push(`( tool: ${op.tool.name}, ${fmt(op.tool.diameter, u)}${u} dia, ${op.tool.flutes} flute )`);
  out.push(`( machine: ${m.name} )`);
  out.push(`( feeds are starting points — verify for your machine and stock )`);
  out.push(u === 'in' ? 'G20' : 'G21');
  out.push('G90');
  out.push('G17');
  for (const h of m.postHeader) out.push(h);
  out.push(`M3 S${Math.round(op.rpm)}`);
  out.push(`G0 Z${X(m.safeZ)}`); // invariant 1

  let curZ = m.safeZ;
  let lastFeed: number | null = null;
  let started = false;
  let plungedAtCurrentZ = false;

  for (const mv of op.moves) {
    const targetZ = mv.z;
    // Depth is measured *below* the stock top (z = 0); positive Z is a retract
    // and can be as high as the machine allows.
    if (-targetZ > opts.maxCutDepth + 1) {
      violations.push(
        `${op.name}: a move reaches ${fmt(-targetZ, u)}${u} deep, past the ${fmt(opts.maxCutDepth, u)}${u} limit.`,
      );
    }

    switch (mv.kind) {
      case 'rapid': {
        // invariant 2: retract before travelling
        if (curZ < m.safeZ) {
          out.push(`G0 Z${X(m.safeZ)}`);
          curZ = m.safeZ;
        }
        out.push(`G0 X${X(mv.to.x)} Y${X(mv.to.y)}`);
        if (targetZ !== curZ && targetZ >= m.safeZ) {
          out.push(`G0 Z${X(targetZ)}`);
          curZ = targetZ;
        }
        plungedAtCurrentZ = false;
        started = true;
        break;
      }
      case 'plunge': {
        // rapid down to just above the cut, then feed in
        const rapidTo = Math.max(targetZ, m.travelZ);
        if (curZ > rapidTo) {
          out.push(`G0 Z${X(rapidTo)}`);
          curZ = rapidTo;
        }
        const f = mv.feed ?? 0;
        if (f !== lastFeed) {
          out.push(`G1 Z${X(targetZ)} F${feedFmt(f, u)}`);
          lastFeed = f;
        } else {
          out.push(`G1 Z${X(targetZ)}`);
        }
        curZ = targetZ;
        plungedAtCurrentZ = true;
        started = true;
        break;
      }
      case 'feed': {
        // invariant 3
        if (!plungedAtCurrentZ && targetZ < 0 && targetZ < curZ) {
          violations.push(`${op.name}: a cutting move descends without a plunge first.`);
        }
        const f = mv.feed ?? 0;
        const zPart = targetZ !== curZ ? ` Z${X(targetZ)}` : '';
        if (f !== lastFeed) {
          out.push(`G1 X${X(mv.to.x)} Y${X(mv.to.y)}${zPart} F${feedFmt(f, u)}`);
          lastFeed = f;
        } else {
          out.push(`G1 X${X(mv.to.x)} Y${X(mv.to.y)}${zPart}`);
        }
        curZ = targetZ;
        started = true;
        break;
      }
    }
  }

  if (!started) violations.push(`${op.name}: no moves were generated.`);

  // invariant 4
  out.push(`G0 Z${X(m.safeZ)}`);
  out.push('M5');
  for (const f of m.postFooter) out.push(f);
  out.push('M2');

  return { text: out.join('\n') + '\n', lines: out.length, violations };
}

/** All enabled operations as separate programs plus one combined file. */
export function emitAllGcode(
  operations: Operation[],
  cnc: CncOptions,
): { files: { name: string; text: string }[]; violations: string[] } {
  const files: { name: string; text: string }[] = [];
  const violations: string[] = [];
  for (const op of operations) {
    const maxCutDepth =
      op.kind === 'profile' ? cnc.stockThickness + cnc.profile.throughDepth : cnc.stockThickness;
    const g = emitGcode(op, cnc, { maxCutDepth });
    violations.push(...g.violations);
    files.push({ name: `${op.kind}.nc`, text: g.text });
  }
  if (files.length > 1) {
    files.push({
      name: 'all-operations.nc',
      text:
        `( BetterBoards — all operations, in cutting order )\n` +
        `( STOP between operations and change tools! )\n` +
        files.map((f) => f.text).join('\n( ---- tool change ---- )\nM0\n'),
    });
  }
  return { files, violations };
}

/* ------------------------------------------------------------------ */
/* Parse-back self-check                                               */
/* ------------------------------------------------------------------ */

export interface ParsedMove {
  rapid: boolean;
  x: number;
  y: number;
  z: number;
}

/**
 * Parse our own output back into moves. Used as an integration self-check:
 * the geometry must round-trip within tolerance.
 */
export function parseGcode(text: string, units: 'in' | 'mm' = 'in'): ParsedMove[] {
  const scale = units === 'in' ? IN : MM;
  const moves: ParsedMove[] = [];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\(.*?\)/g, '').trim();
    if (!line) continue;
    const gm = line.match(/^G(0|1)\b/);
    if (!gm) continue;
    const rapid = gm[1] === '0';
    const xm = line.match(/X(-?[\d.]+)/);
    const ym = line.match(/Y(-?[\d.]+)/);
    const zm = line.match(/Z(-?[\d.]+)/);
    if (xm) x = parseFloat(xm[1]) * scale;
    if (ym) y = parseFloat(ym[1]) * scale;
    if (zm) z = parseFloat(zm[1]) * scale;
    moves.push({ rapid, x, y, z });
  }
  return moves;
}

/** Static safety audit of emitted text — the check a user can run before cutting. */
export function auditGcode(text: string, cnc: CncOptions, maxCutDepth: Nm): string[] {
  const problems: string[] = [];
  const moves = parseGcode(text, cnc.machine.units);
  if (moves.length === 0) return ['No motion in the program.'];

  const safeZ = cnc.machine.safeZ;
  if (!(moves[0].rapid && moves[0].z >= safeZ - 1)) {
    problems.push('The first motion is not a rapid to safe Z.');
  }
  const last = moves[moves.length - 1];
  if (!(last.z >= safeZ - 1)) problems.push('The program does not end at safe Z.');
  if (!/\bM5\b/.test(text)) problems.push('The spindle is never turned off (no M5).');
  if (!/\bM3\b/.test(text)) problems.push('The spindle is never turned on (no M3).');
  if (!/^G(20|21)$/m.test(text)) problems.push('No units word (G20/G21).');
  if (!/^G90$/m.test(text)) problems.push('No absolute-distance word (G90).');

  for (let i = 1; i < moves.length; i++) {
    const m = moves[i];
    const p = moves[i - 1];
    if (-m.z > maxCutDepth + 1) {
      problems.push(`A move cuts deeper than the allowed ${(maxCutDepth / IN).toFixed(3)}″.`);
      break;
    }
    // a rapid that moves in XY while below safe Z would gouge the work
    if (m.rapid && (m.x !== p.x || m.y !== p.y) && m.z < safeZ - 1) {
      problems.push('A rapid traverses in XY below safe Z.');
      break;
    }
  }
  return problems;
}
