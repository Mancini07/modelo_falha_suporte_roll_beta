export interface LinearScale {
  (value: number): number;
  invert(px: number): number;
  domain: [number, number];
  range: [number, number];
}

export function linear(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;

  const fn = ((v: number) => r0 + ((v - d0) / span) * (r1 - r0)) as LinearScale;
  fn.invert = (px: number) => d0 + ((px - r0) / (r1 - r0 || 1)) * span;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

/** Rounded bounds with headroom, so the line never touches the frame. */
export function niceDomain(values: number[], padRatio = 0.08): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * padRatio;
  return [min - pad, max + pad];
}

/** Axis ticks on readable steps (1, 2, 2.5, 5 × 10^n). */
export function ticks(domain: [number, number], count = 5): number[] {
  const [d0, d1] = domain;
  const raw = (d1 - d0) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 2.2 ? 2.5 : norm >= 1.5 ? 2 : 1) * mag;

  const out: number[] = [];
  for (let v = Math.ceil(d0 / step) * step; v <= d1 + step * 1e-9; v += step) {
    out.push(Math.round(v / step) * step);
  }
  return out;
}

/** Evenly spaced time ticks across the range. */
export function timeTicks(domain: [number, number], count = 6): number[] {
  const [t0, t1] = domain;
  const step = (t1 - t0) / (count - 1 || 1);
  return Array.from({ length: count }, (_, i) => t0 + i * step);
}

/** Polyline path, broken wherever the gap between samples is too long. */
export function linePath(
  points: Array<{ x: number; y: number; t: number }>,
  maxGapMs = Infinity,
): string {
  let d = '';
  let pen = false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const gap = i > 0 ? p.t - points[i - 1].t : 0;
    if (!pen || gap > maxGapMs) {
      d += `M${p.x.toFixed(2)},${p.y.toFixed(2)}`;
      pen = true;
    } else {
      d += `L${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    }
  }
  return d;
}
