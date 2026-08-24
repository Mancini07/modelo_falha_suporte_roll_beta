import type { AnalysisResult } from '../../types';
import { c1, signed, duration, stampFull } from '../../format.en';

interface Props {
  data: AnalysisResult;
}

/**
 * Current state of the pair. On failure the tile blinks red — and always carries
 * an icon and a label, so the alert never rests on colour or motion alone.
 */
export default function StatusHero({ data }: Props) {
  const { summary, settings, pointA, pointB } = data;
  const latest = summary.latest;
  const isAlarm = summary.status === 'ALARME';

  return (
    <section className="hero">
      <div className={`hero-state${isAlarm ? ' is-alarm' : ''}`} role="status" aria-live="polite">
        <span className="state-eyebrow">Current state</span>

        {summary.status === 'SEM_DADOS' ? (
          <>
            <span className="state-label is-idle">— No comparison</span>
            <span className="state-note">
              No pair of readings within the {settings.toleranceMs / 60_000} min tolerance.
            </span>
          </>
        ) : isAlarm ? (
          <>
            <span className="state-label">⚠ Lubrication failure</span>
            <span className="state-value">{signed(latest!.delta)}</span>
            <span className="state-note">
              Deviation above the {settings.thresholdC} °C limit
              {summary.alarmStreakMs != null && summary.alarmStreakMs > 0
                ? ` for ${duration(summary.alarmStreakMs)}`
                : ''}
              .
            </span>
          </>
        ) : (
          <>
            <span className="state-label is-normal">✓ Normal</span>
            <span className="state-value">{signed(latest!.delta)}</span>
            <span className="state-note">Deviation within the {settings.thresholdC} °C limit.</span>
          </>
        )}

        {latest && <span className="state-note">Last comparison: {stampFull(latest.t)}</span>}
      </div>

      <div className="metrics">
        <div className="metric">
          <div className="k">Point A</div>
          <div className="v" style={latest ? { color: 'var(--series-a)' } : undefined}>
            {latest ? c1(latest.a) : '—'}
          </div>
          <div className="d">{pointA.positionName}</div>
        </div>
        <div className="metric">
          <div className="k">Point B</div>
          <div className="v" style={latest ? { color: 'var(--series-b)' } : undefined}>
            {latest ? c1(latest.b) : '—'}
          </div>
          <div className="d">{pointB.positionName}</div>
        </div>
        <div className="metric">
          <div className="k">Peak in period</div>
          <div className={`v${summary.maxAbsDelta != null && summary.maxAbsDelta > settings.thresholdC ? ' alarm' : ''}`}>
            {summary.maxAbsDelta != null ? c1(summary.maxAbsDelta) : '—'}
          </div>
          <div className="d">avg {summary.avgAbsDelta != null ? c1(summary.avgAbsDelta) : '—'}</div>
        </div>
      </div>
    </section>
  );
}
