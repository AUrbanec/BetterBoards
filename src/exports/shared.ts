import { expandLayers, type BoardSpec, type SpeciesId } from '../engine/construction/types';

/** Stable species letter labels (A, B, C…) by first appearance in the stack. */
export function speciesLetters(board: BoardSpec): Map<SpeciesId, string> {
  const letters = new Map<SpeciesId, string>();
  const strips = expandLayers(board.construction.layers);
  let i = 0;
  for (const s of strips) {
    if (!letters.has(s.species)) {
      letters.set(s.species, String.fromCharCode(65 + (i % 26)));
      i++;
    }
  }
  return letters;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Compact "2, 4, 6 … 12" run formatting for slice lists. */
export function formatSliceList(nums: number[]): string {
  if (nums.length === 0) return '';
  if (nums.length <= 6) return nums.join(', ');
  const step = nums[1] - nums[0];
  const arithmetic = nums.every((n, i) => i === 0 || n - nums[i - 1] === step);
  if (arithmetic) return `${nums[0]}, ${nums[1]}, ${nums[2]} … ${nums[nums.length - 1]}`;
  return nums.join(', ');
}
