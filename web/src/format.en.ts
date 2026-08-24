/** Formatters. The whole interface is English. */

export const c1 = (n: number) => `${n.toFixed(1)} °C`;
export const c2 = (n: number) => `${n.toFixed(2)} °C`;

/** Signed deviation, one decimal — used on the compact twin cards. */
export const signed1 = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} °C`;

/** Signed deviation, two decimals — used on the analytics screen. */
export const signed = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)} °C`;

export function minutes(ms: number): string {
  const m = ms / 60_000;
  return m < 10 ? `${m.toFixed(1)} min` : `${Math.round(m)} min`;
}

export function duration(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

const dt = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const dtFull = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

export const stamp = (t: number) => dt.format(new Date(t));
export const stampFull = (t: number) => dtFull.format(new Date(t));

/** Strips the numbering prefix ("03.6 - Bearing DE" -> "Bearing DE"). */
export function shortName(name: string): string {
  return name.replace(/^\s*[\d.]+\s*-\s*/, '').trim();
}
