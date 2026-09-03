export interface ReliefSettings {
  maxDepthMm: number;
  levels: number;
  blurRadius: number;
  contrast: number;
  invert: boolean;
}

export interface ReliefPlan {
  width: number;
  height: number;
  depths: Float32Array;
  levelDepths: number[];
  removedPercent: number;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

/** Convert pixels into a stepped tonal relief. Dark pixels are cut deepest by default. */
export function createReliefPlan(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  settings: ReliefSettings,
): ReliefPlan {
  if (width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error('Invalid image data.');
  if (settings.maxDepthMm <= 0 || settings.levels < 2) throw new Error('Relief depth and level count must be positive.');

  let tones: Float32Array<ArrayBufferLike> = new Float32Array(width * height);
  for (let i = 0; i < tones.length; i++) {
    const alpha = rgba[i * 4 + 3] / 255;
    const linear = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
    tones[i] = linear * alpha + (1 - alpha);
  }

  for (let pass = 0; pass < Math.round(settings.blurRadius); pass++) tones = boxBlur(tones, width, height);

  const depths = new Float32Array(tones.length);
  let removed = 0;
  for (let i = 0; i < tones.length; i++) {
    const contrasted = clamp((tones[i] - 0.5) * settings.contrast + 0.5);
    const removal = settings.invert ? contrasted : 1 - contrasted;
    const step = Math.round(removal * (settings.levels - 1));
    depths[i] = (step / (settings.levels - 1)) * settings.maxDepthMm;
    removed += depths[i] / settings.maxDepthMm;
  }

  return {
    width,
    height,
    depths,
    levelDepths: Array.from({ length: settings.levels }, (_, i) => (i / (settings.levels - 1)) * settings.maxDepthMm),
    removedPercent: (removed / depths.length) * 100,
  };
}

function boxBlur(input: Float32Array<ArrayBufferLike>, width: number, height: number): Float32Array<ArrayBufferLike> {
  const output = new Float32Array(input.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let total = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < width && yy >= 0 && yy < height) {
          total += input[yy * width + xx];
          count++;
        }
      }
      output[y * width + x] = total / count;
    }
  }
  return output;
}

export function sampleReliefGrid(plan: ReliefPlan, columns: number, rows: number): number[][] {
  return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => {
    const x = Math.round((column / Math.max(1, columns - 1)) * (plan.width - 1));
    const y = Math.round((row / Math.max(1, rows - 1)) * (plan.height - 1));
    return plan.depths[y * plan.width + x];
  }));
}

export function reliefGridCsv(plan: ReliefPlan, columns: number, rows: number): string {
  const grid = sampleReliefGrid(plan, columns, rows);
  return ['Row/Column,' + grid[0].map((_, i) => i + 1).join(','), ...grid.map((row, i) => `${i + 1},${row.map((d) => d.toFixed(2)).join(',')}`)].join('\r\n');
}
