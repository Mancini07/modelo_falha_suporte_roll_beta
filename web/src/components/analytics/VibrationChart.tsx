import { useMemo, useState } from 'react';
import type { VibrationSample } from '../../types';
import { linear, niceDomain, ticks, timeTicks, linePath } from '../../scale';
import { stamp, stampFull } from '../../format.en';

const W = 980;
const H = 270;
const M = { top: 16, right: 138, bottom: 34, left: 62 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/**
 * Os três eixos da máquina. As cores são próprias — azul e laranja seguem
 * reservados para identificar os pontos A e B no resto do painel, e não podem
 * significar duas coisas diferentes. Estas três passaram na validação de
 * daltonismo contra a superfície escura.
 */
export const AXES = [
  { id: 'X', label: 'Horizontal', color: 'var(--axis-h)' },
  { id: 'Y', label: 'Vertical', color: 'var(--axis-v)' },
  { id: 'Z', label: 'Axial', color: 'var(--axis-a)' },
] as const;

export type AxisId = (typeof AXES)[number]['id'];

interface Props {
  series: VibrationSample[];
  /** 'acc' lê accX/Y/Z, 'vel' lê velX/Y/Z */
  measure: 'acc' | 'vel';
  unit: string;
  decimals: number;
  /** Linha de referência horizontal — o mínimo para o sensor contar como montado. */
  reference?: { value: number; label: string } | null;
}

function pick(s: VibrationSample, measure: 'acc' | 'vel', axis: AxisId): number | null {
  if (measure === 'acc') return axis === 'X' ? s.accX : axis === 'Y' ? s.accY : s.accZ;
  return axis === 'X' ? s.velX : axis === 'Y' ? s.velY : s.velZ;
}

interface Point { t: number; v: number }

/** Afasta rótulos que ficariam sobrepostos, preservando a ordem vertical. */
function spread(labels: Array<{ y: number; i: number }>, minGap = 14): number[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].y - sorted[k - 1].y < minGap) sorted[k].y = sorted[k - 1].y + minGap;
  }
  const out: number[] = [];
  for (const s of sorted) out[s.i] = s.y;
  return out;
}

/**
 * Aceleração ou velocidade de UM ponto, nos três eixos da máquina, na mesma
 * escala. Começa no zero: vibração é magnitude, e cortar a base exagera
 * variações pequenas.
 */
export default function VibrationChart({ series, measure, unit, decimals, reference }: Props) {
  const [hover, setHover] = useState<{ t: number; vals: Array<number | null>; x: number } | null>(null);

  const geom = useMemo(() => {
    const byAxis = AXES.map((ax) =>
      series
        .map((s) => ({ t: s.t, v: pick(s, measure, ax.id) }))
        .filter((p): p is Point => p.v != null),
    );

    const values = byAxis.flat().map((p) => p.v);
    if (values.length === 0) return null;

    const times = byAxis.flat().map((p) => p.t);
    const xDomain: [number, number] = [Math.min(...times), Math.max(...times)];
    // A referência precisa caber na escala, senão o ajuste sai da vista.
    const top = Math.max(niceDomain(values, 0.12)[1], (reference?.value ?? 0) * 1.15);
    const yDomain: [number, number] = [0, top];

    const x = linear(xDomain, [M.left, M.left + PLOT_W]);
    const y = linear(yDomain, [M.top + PLOT_H, M.top]);
    const maxGap = 4 * 60 * 60 * 1000;

    return {
      byAxis, x, y, xDomain, yDomain,
      paths: byAxis.map((pts) => linePath(pts.map((p) => ({ x: x(p.t), y: y(p.v), t: p.t })), maxGap)),
    };
  }, [series, measure, reference?.value]);

  if (!geom) return <p className="muted">No vibration readings in this period.</p>;
  const { byAxis, x, y, xDomain, yDomain } = geom;

  const nearest = (pts: Point[], t: number): Point | null => {
    if (pts.length === 0) return null;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    return Math.abs(best.t - t) <= 30 * 60_000 ? best : null;
  };

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = x.invert(px);
    const hits = byAxis.map((pts) => nearest(pts, t));
    const ref = hits.find((h) => h != null);
    if (!ref) return;
    setHover({ t: ref.t, vals: hits.map((h) => h?.v ?? null), x: x(ref.t) });
  }

  const lasts = byAxis.map((pts) => pts[pts.length - 1] ?? null);
  const labelYs = spread(
    lasts.map((p, i) => ({ y: p ? y(p.v) : M.top + PLOT_H, i })).filter((l) => lasts[l.i] != null),
  );
  const tooltipLeft = hover ? Math.min(Math.max((hover.x / W) * 100, 4), 70) : 0;

  return (
    <div className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${measure === 'acc' ? 'Acceleration' : 'Velocity'} RMS on the horizontal, vertical and axial axes, in ${unit}.`}
      >
        {ticks(yDomain, 4).map((v) => (
          <g key={v}>
            <line className="grid-line" x1={M.left} x2={M.left + PLOT_W} y1={y(v)} y2={y(v)} />
            <text className="axis-text" x={M.left - 9} y={y(v)} textAnchor="end" dominantBaseline="middle">
              {v.toFixed(decimals)}
            </text>
          </g>
        ))}

        <line className="axis-line" x1={M.left} x2={M.left + PLOT_W} y1={M.top + PLOT_H} y2={M.top + PLOT_H} />
        {timeTicks(xDomain, 6).map((t, i) => (
          <text
            key={i}
            className="axis-text"
            x={x(t)}
            y={M.top + PLOT_H + 17}
            textAnchor={i === 0 ? 'start' : i === 5 ? 'end' : 'middle'}
          >
            {stamp(t)}
          </text>
        ))}

        {/* Linha do limiar, sob as séries para não escondê-las. O rótulo fica
            DENTRO do gráfico: a margem direita já é dos rótulos dos eixos. */}
        {reference && (
          <>
            <line
              x1={M.left} x2={M.left + PLOT_W}
              y1={y(reference.value)} y2={y(reference.value)}
              style={{ stroke: 'var(--warning)', strokeWidth: 1.5, strokeDasharray: '5 4' }}
            />
            <text
              className="axis-text"
              x={M.left + 8}
              y={y(reference.value) - 7}
              fill="var(--warning)"
              fontWeight={620}
            >
              mounted ≥ {reference.label}
            </text>
          </>
        )}

        {AXES.map((ax, i) => (
          <path key={ax.id} className="series-line" d={geom.paths[i]} stroke={ax.color} />
        ))}

        {/* rótulo direto na ponta de cada eixo: identidade nunca só pela cor */}
        {AXES.map((ax, i) => {
          const p = lasts[i];
          if (!p) return null;
          return (
            <g key={`lab-${ax.id}`}>
              <circle cx={x(p.t)} cy={y(p.v)} r={4} fill={ax.color} stroke="var(--surface-1)" strokeWidth={2} />
              <text
                className="axis-text"
                x={M.left + PLOT_W + 10}
                y={labelYs[i]}
                dominantBaseline="middle"
                fill={ax.color}
                fontWeight={620}
              >
                {p.v.toFixed(decimals)}
              </text>
              <text className="axis-text" x={M.left + PLOT_W + 62} y={labelYs[i]} dominantBaseline="middle">
                {ax.label.slice(0, 4).toLowerCase()}
              </text>
            </g>
          );
        })}

        {hover && (
          <>
            <line className="grid-line" x1={hover.x} x2={hover.x} y1={M.top} y2={M.top + PLOT_H} stroke="var(--border-strong)" />
            {AXES.map((ax, i) =>
              hover.vals[i] == null ? null : (
                <circle key={ax.id} cx={hover.x} cy={y(hover.vals[i]!)} r={5} fill={ax.color} stroke="var(--surface-1)" strokeWidth={2} />
              ),
            )}
          </>
        )}

        <rect
          x={M.left} y={M.top} width={PLOT_W} height={PLOT_H} fill="transparent"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        />
      </svg>

      {hover && (
        <div className="tooltip" style={{ left: `${tooltipLeft}%`, top: 8 }}>
          <div className="tt-time">{stampFull(hover.t)}</div>
          {AXES.map((ax, i) => (
            <div className="tt-row" key={ax.id}>
              <span className="name"><i className="dot" style={{ background: ax.color }} />{ax.label}</span>
              <span className="val">
                {hover.vals[i] != null ? `${hover.vals[i]!.toFixed(decimals)} ${unit}` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
