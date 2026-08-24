import { useMemo, useState } from 'react';
import type { AnalysisResult, ComparedPair } from '../../types';
import { linear, niceDomain, ticks, timeTicks, linePath } from '../../scale';
import { c1, signed, stamp, stampFull } from '../../format.en';

const W = 980;
const H = 380;
const M = { top: 18, right: 128, bottom: 34, left: 52 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

interface Props {
  data: AnalysisResult;
}

/**
 * Both temperatures on one shared scale (same unit, so one Y axis). Where the
 * pair breaks the limit, a pulsing red connector links the two readings — the
 * deviation becomes a visible distance rather than a hidden number.
 */
export default function TempChart({ data }: Props) {
  const { seriesA, seriesB, pairs, settings, pointA, pointB } = data;
  const [hover, setHover] = useState<{ pair: ComparedPair; x: number } | null>(null);

  const geom = useMemo(() => {
    const all = [...seriesA.map((s) => s.v), ...seriesB.map((s) => s.v)];
    const times = [...seriesA.map((s) => s.t), ...seriesB.map((s) => s.t)];
    if (all.length === 0) return null;

    const xDomain: [number, number] = [Math.min(...times), Math.max(...times)];
    const yDomain = niceDomain(all, 0.1);

    const x = linear(xDomain, [M.left, M.left + PLOT_W]);
    const y = linear(yDomain, [M.top + PLOT_H, M.top]);

    // Break the line where the sensor went quiet, so we never draw a straight
    // segment implying readings that never existed.
    const maxGap = 90 * 60_000;

    return {
      x, y, xDomain, yDomain,
      pathA: linePath(seriesA.map((s) => ({ x: x(s.t), y: y(s.v), t: s.t })), maxGap),
      pathB: linePath(seriesB.map((s) => ({ x: x(s.t), y: y(s.v), t: s.t })), maxGap),
    };
  }, [seriesA, seriesB]);

  if (!geom) return <p className="muted">No temperature readings in this period.</p>;
  const { x, y, xDomain, yDomain } = geom;

  const alarms = pairs.filter((p) => p.alarm);
  const lastA = seriesA[seriesA.length - 1];
  const lastB = seriesB[seriesB.length - 1];

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    if (pairs.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = x.invert(px);
    let best = pairs[0];
    for (const p of pairs) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    setHover({ pair: best, x: x(best.t) });
  }

  const tooltipLeft = hover ? Math.min(Math.max((hover.x / W) * 100, 4), 74) : 0;

  return (
    <div className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Temperature of both points over time. ${alarms.length} readings exceed the ${settings.thresholdC} degree limit.`}
      >
        {ticks(yDomain, 5).map((v) => (
          <g key={v}>
            <line className="grid-line" x1={M.left} x2={M.left + PLOT_W} y1={y(v)} y2={y(v)} />
            <text className="axis-text" x={M.left - 9} y={y(v)} textAnchor="end" dominantBaseline="middle">
              {v.toFixed(0)}°
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

        {/* deviation connector between the two readings of a breaching pair */}
        {alarms.map((p) => (
          <line
            key={`gap-${p.t}`}
            className="alarm-mark"
            x1={x(p.t)} x2={x(p.t)}
            y1={y(p.a)} y2={y(p.b)}
            stroke="var(--critical)" strokeWidth={2.5} strokeLinecap="round" opacity={0.85}
          />
        ))}

        <path className="series-line" d={geom.pathA} stroke="var(--series-a)" />
        <path className="series-line" d={geom.pathB} stroke="var(--series-b)" />

        {lastA && (
          <>
            <circle cx={x(lastA.t)} cy={y(lastA.v)} r={4.5} fill="var(--series-a)" stroke="var(--surface-1)" strokeWidth={2} />
            <text className="axis-text" x={M.left + PLOT_W + 12} y={y(lastA.v)} dominantBaseline="middle" fill="var(--series-a)" fontWeight={620}>
              {c1(lastA.v)}
            </text>
            <text className="axis-text" x={M.left + PLOT_W + 12} y={y(lastA.v) + 13} dominantBaseline="middle">
              point A
            </text>
          </>
        )}
        {lastB && (
          <>
            <circle cx={x(lastB.t)} cy={y(lastB.v)} r={4.5} fill="var(--series-b)" stroke="var(--surface-1)" strokeWidth={2} />
            <text className="axis-text" x={M.left + PLOT_W + 12} y={y(lastB.v)} dominantBaseline="middle" fill="var(--series-b)" fontWeight={620}>
              {c1(lastB.v)}
            </text>
            <text className="axis-text" x={M.left + PLOT_W + 12} y={y(lastB.v) + 13} dominantBaseline="middle">
              point B
            </text>
          </>
        )}

        {hover && (
          <>
            <line className="grid-line" x1={hover.x} x2={hover.x} y1={M.top} y2={M.top + PLOT_H} stroke="var(--border-strong)" />
            <circle cx={hover.x} cy={y(hover.pair.a)} r={5.5} fill="var(--series-a)" stroke="var(--surface-1)" strokeWidth={2} />
            <circle cx={hover.x} cy={y(hover.pair.b)} r={5.5} fill="var(--series-b)" stroke="var(--surface-1)" strokeWidth={2} />
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
            <span className="name"><i className="dot" style={{ background: 'var(--series-a)' }} />{pointA.positionName}</span>
            <span className="val">{c1(hover.pair.a)}</span>
          </div>
          <div className="tt-row">
            <span className="name"><i className="dot" style={{ background: 'var(--series-b)' }} />{pointB.positionName}</span>
            <span className="val">{c1(hover.pair.b)}</span>
          </div>
          <div className="tt-sep" />
          <div className="tt-row">
            <span className="name">Deviation</span>
            <span className="val" style={{ color: hover.pair.alarm ? 'var(--critical)' : undefined }}>
              {signed(hover.pair.delta)}
            </span>
          </div>
          {hover.pair.alarm && <div className="tt-alarm">⚠ Lubrication failure</div>}
        </div>
      )}
    </div>
  );
}
