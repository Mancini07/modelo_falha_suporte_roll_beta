import { useEffect, useState } from 'react';
import { fetchAnalysis } from '../api';
import type { AnalysisResult, AnalysisSettings, PairState } from '../types';
import StatusHero from '../components/analytics/StatusHero';
import TempChart from '../components/analytics/TempChart';
import DeltaChart from '../components/analytics/DeltaChart';
import PairTable from '../components/analytics/PairTable';
import { minutes } from '../format.en';

interface Props {
  /** Pinned pairs from the board, offered as ready-made choices. */
  pinned: PairState[];
  thresholdC: number;
  toleranceMin: number;
  /** Pair pre-selected when arriving from a board card. */
  initialPairId: string | null;
  /** Back to the board — the only way out, now that the tabs are gone. */
  onBack: () => void;
}

const PERIODS = [1, 3, 7, 15, 30];

export default function AnalyticsView({ pinned, thresholdC, toleranceMin, initialPairId, onBack }: Props) {
  const first = pinned.find((p) => p.id === initialPairId) ?? pinned[0];

  const [settings, setSettings] = useState<AnalysisSettings>({
    pointA: first?.pointA.positionId ?? 21547,
    pointB: first?.pointB.positionId ?? 21548,
    days: 7,
    thresholdC,
    toleranceMin,
  });

  const [data, setData] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  // The board owns the limit and the tolerance; analytics follows them.
  useEffect(() => {
    setSettings((s) => ({ ...s, thresholdC, toleranceMin }));
  }, [thresholdC, toleranceMin]);

  useEffect(() => {
    const ctrl = new AbortController();
    setBusy(true);
    setError(null);
    fetchAnalysis(settings, ctrl.signal)
      .then(setData)
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => setBusy(false));
    return () => ctrl.abort();
  }, [settings]);

  const selectedId = `${settings.pointA}-${settings.pointB}`;
  const company = data?.pointA.companyName ?? data?.pointB.companyName;
  const facility = data?.pointA.facilityName ?? data?.pointB.facilityName;
  const asset = data?.pointA.assetName ?? data?.pointB.assetName;

  return (
    <>
      <header className="masthead">
        <div>
          <button className="back-link" onClick={onBack}>← Back to board</button>
          <h1>Lubrication failure · analytics</h1>
          <p className="breadcrumb">
            {company ? <strong>{company}</strong> : '—'}
            {facility && <> · {facility}</>}
            {asset && <> · {asset}</>}
          </p>
        </div>
        <div className="toolbar">
          <span className="chip">limit {settings.thresholdC} °C</span>
          <span className="chip">tolerance {settings.toleranceMin} min</span>
        </div>
      </header>

      <section className="card">
        <div className="controls">
          <div className="field">
            <label htmlFor="an-pair">Asset</label>
            <select
              id="an-pair"
              value={pinned.some((p) => p.id === selectedId) ? selectedId : 'custom'}
              onChange={(e) => {
                const p = pinned.find((x) => x.id === e.target.value);
                if (p) {
                  setSettings((s) => ({
                    ...s,
                    pointA: p.pointA.positionId,
                    pointB: p.pointB.positionId,
                  }));
                }
              }}
            >
              {!pinned.some((p) => p.id === selectedId) && (
                <option value="custom">Custom pair</option>
              )}
              {pinned.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.assetName} — {p.facilityName}
                </option>
              ))}
            </select>
            <span className="hint">pinned on the board</span>
          </div>

          <div className="field">
            <label htmlFor="an-a">Point A</label>
            <input
              id="an-a" type="number" value={settings.pointA}
              onChange={(e) => setSettings((s) => ({ ...s, pointA: Number(e.target.value) }))}
            />
          </div>
          <div className="field">
            <label htmlFor="an-b">Point B</label>
            <input
              id="an-b" type="number" value={settings.pointB}
              onChange={(e) => setSettings((s) => ({ ...s, pointB: Number(e.target.value) }))}
            />
          </div>

          <div className="field">
            <label htmlFor="an-days">Period</label>
            <select
              id="an-days" value={settings.days}
              onChange={(e) => setSettings((s) => ({ ...s, days: Number(e.target.value) }))}
            >
              {PERIODS.map((d) => (
                <option key={d} value={d}>{d === 1 ? '24 hours' : `${d} days`}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {error && <div className="card error">Failed to load: {error}</div>}
      {busy && !data && <div className="card loading">Loading readings…</div>}

      {data && (
        <>
          {data.pairs.length === 0 && (
            <div className="notice">
              <span className="icon">⚠️</span>
              <div>
                <h3>No comparison possible at a {settings.toleranceMin} min tolerance</h3>
                <p>
                  {data.diagnostics.minLagMs != null ? (
                    <>
                      These two sensors transmit in different gateway slots: the smallest lag
                      observed is <code>{minutes(data.diagnostics.minLagMs)}</code>, so no pair
                      meets the simultaneity criterion. Raise the tolerance on the board.
                    </>
                  ) : (
                    <>
                      One of the points has no temperature readings in this period
                      ({data.diagnostics.samplesA} and {data.diagnostics.samplesB} samples).
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          <StatusHero data={data} />

          <section className="card">
            <header><h2>Temperature of both points</h2></header>
            <p className="sub">
              One shared scale. Where the deviation exceeds {data.settings.thresholdC} °C, a
              pulsing red connector links the two readings.
            </p>
            <div className="legend" style={{ marginBottom: 10 }}>
              <span className="legend-item">
                <i className="legend-swatch" style={{ background: 'var(--series-a)' }} />
                {data.pointA.positionName}
              </span>
              <span className="legend-item">
                <i className="legend-swatch" style={{ background: 'var(--series-b)' }} />
                {data.pointB.positionName}
              </span>
              <span className="legend-item">
                <i className="legend-swatch" style={{ background: 'var(--critical)' }} />
                deviation above the limit
              </span>
            </div>
            <TempChart data={data} />
          </section>

          <section className="card">
            <header><h2>Deviation against the limit</h2></header>
            <p className="sub">
              {data.pointA.positionName} − {data.pointB.positionName} at every comparison.
              Outside the grey band it is a lubrication failure.
            </p>
            <DeltaChart data={data} />
          </section>

          <PairTable data={data} />

          <p className="muted" style={{ fontSize: 12 }}>
            {data.diagnostics.samplesA} readings on point A and {data.diagnostics.samplesB} on
            point B · {data.pairs.length} valid comparisons ·{' '}
            {data.diagnostics.discarded} discarded for time lag.
          </p>
        </>
      )}
    </>
  );
}
