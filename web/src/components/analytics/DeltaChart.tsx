import { useMemo, useState } from 'react';
import type { AnalysisResult, ComparedPair } from '../../types';
import { linear, niceDomain, ticks, timeTicks, linePath } from '../../scale';
import { c1, signed, stamp, stampFull } from '../../format.en';

const W = 980;
const H = 260;
const M = { top: 16, right: 128, bottom: 34, left: 52 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

interface Props {
  data: AnalysisResult;
}

/**
 * The deviation against the tolerated band. Anything leaving the grey band is a
 * lubrication failure — the reading is "it left the band", not "read the number".
 */
export default function DeltaChart({ data }: Props) {
  const { pairs, settings } = data;
  const [hover, setHover] = useState<{ pair: ComparedPair; x: number } | null>(null);

  const geom = useMemo(() => {
    if (pairs.length === 0) return null;
    const th = settings.thresholdC;
    const deltas = pairs.map((p) => p.delta);
    const times = pairs.map((p) => p.t);

    const xDomain: [number, number] = [Math.min(...times), Math.max(...times)];
    // The tolerated band always stays on scale, otherwise the limit falls off view.
    const yDomain = niceDomain([...deltas, th * 1.25, -th * 1.25], 0.06);

    const x = linear(xDomain, [M.left, M.left + PLOT_W]);
    const y = linear(yDomain, [M.top + PLOT_H, M.top]);

    return {
      x, y, xDomain, yDomain,
      path: linePath(pairs.map((p) => ({ x: x(p.t), y: y(p.delta), t: p.t })), 90 * 60_000),
    };
  }, [pairs, settings.thresholdC]);

  if (!geom) return <p className="muted">No comparable pairs to compute the deviation.</p>;
  const { x, y, xDomain, yDomain } = geom;
  const th = settings.thresholdC;

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = x.invert(px);
    let best = pairs[0];
    for (const p of pairs) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    setHover({ pair: best, x: x(best.t) });
  }

  const tooltipLeft = hover ? Math.min(Math.max((hover.x / W) * 100, 4), 74) : 0;
  const bandTop = y(th);
  const bandBottom = y(-th);

  return (
    <div className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Temperature deviation between the two points against the tolerated band of plus or minus ${th} degrees.`}
      >
        <rect x={M.left} y={bandTop} width={PLOT_W} height={bandBottom - bandTop} fill="var(--surface-2)" />
        <line className="threshold-line" x1={M.left} x2={M.left + PLOT_W} y1={bandTop} y2={bandTop} />
        <line className="threshold-line" x1={M.left} x2={M.left + PLOT_W} y1={bandBottom} y2={bandBottom} />
        <text className="axis-text" x={M.left + PLOT_W + 12} y={bandTop} dominantBaseline="middle" fill="var(--critical)" fontWeight={620}>
          +{th}°C
        </text>
        <text className="axis-text" x={M.left + PLOT_W + 12} y={bandBottom} dominantBaseline="middle" fill="var(--critical)" fontWeight={620}>
          −{th}°C
        </text>
        <text className="axis-text" x={M.left + PLOT_W + 12} y={(bandTop + bandBottom) / 2} dominantBaseline="middle">
          tolerated band
        </text>

        {ticks(yDomain, 4).map((v) => (
          <text key={v} className="axis-text" x={M.left - 9} y={y(v)} textAnchor="end" dominantBaseline="middle">
            {v.toFixed(1)}
          </text>
        ))}

        <line className="axis-line" x1={M.left} x2={M.left + PLOT_W} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" />

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

        <path className="series-line" d={geom.path} stroke="var(--text-secondary)" strokeWidth={1.6} opacity={0.55} />

        {pairs.filter((p) => p.alarm).map((p) => (
          <circle
            key={p.t}
            className="alarm-mark"
            cx={x(p.t)} cy={y(p.delta)} r={3.6}
            fill="var(--critical)" stroke="var(--surface-1)" strokeWidth={1.4}
          />
        ))}

        {hover && (
          <>
            <line className="grid-line" x1={hover.x} x2={hover.x} y1={M.top} y2={M.top + PLOT_H} stroke="var(--border-strong)" />
            <circle
              cx={hover.x} cy={y(hover.pair.delta)} r={5.5}
              fill={hover.pair.alarm ? 'var(--critical)' : 'var(--text-secondary)'}
              stroke="var(--surface-1)" strokeWidth={2}
            />
          </>
        )}

        <rect
          x={M.left} y={M.top} width={PLOT_W} height={PLOT_H} fill="transparent"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        />
      </svg>

      {hover && (
        <div className="tooltip" style={{ left: `${tooltipLeft}%`, top: 8 }}>
          <div className="tt-time">{stampFull(hover.pair.t)}</div>
          <div className="tt-row">
            <span className="name">Deviation</span>
            <span className="val" style={{ color: hover.pair.alarm ? 'var(--critical)' : undefined }}>
              {signed(hover.pair.delta)}
            </span>
          </div>
          <div className="tt-row">
            <span className="name">Readings</span>
            <span className="val">{c1(hover.pair.a)} / {c1(hover.pair.b)}</span>
          </div>
          {hover.pair.alarm && <div className="tt-alarm">⚠ Lubrication failure</div>}
        </div>
      )}
    </div>
  );
}
