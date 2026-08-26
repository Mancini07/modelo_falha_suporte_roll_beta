import { useEffect, useState } from 'react';
import { fetchAnalysis, setPairSettings } from '../api';
import type { AnalysisResult, AnalysisSettings, PairState } from '../types';
import StatusHero from '../components/analytics/StatusHero';
import TempChart from '../components/analytics/TempChart';
import DeltaChart from '../components/analytics/DeltaChart';
import PairTable from '../components/analytics/PairTable';
import VibrationChart, { AXES } from '../components/analytics/VibrationChart';
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

  /** Qual dos dois pontos está sendo inspecionado nos gráficos de vibração. */
  const [vibPoint, setVibPoint] = useState<'A' | 'B'>('A');
  /** Limiar em edição — string para permitir o campo vazio enquanto digita. */
  const [mountDraft, setMountDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
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

  // O limiar em edição acompanha o par carregado, até o usuário mexer.
  useEffect(() => {
    if (data) setMountDraft(String(data.settings.mountedMinAccG));
  }, [data?.settings.mountedMinAccG, data?.pointA.positionId]);

  const selectedId = `${settings.pointA}-${settings.pointB}`;

  /** O par cravado correspondente — só nele dá para gravar o limiar. */
  const pinnedPair =
    pinned.find(
      (p) =>
        (p.pointA.positionId === settings.pointA && p.pointB.positionId === settings.pointB) ||
        (p.pointA.positionId === settings.pointB && p.pointB.positionId === settings.pointA),
    ) ?? null;

  const parsedMount = Number(mountDraft);
  const mountValid = Number.isFinite(parsedMount) && parsedMount > 0;
  const mountValue = mountValid ? parsedMount : (data?.settings.mountedMinAccG ?? 0.03);
  const mountChanged = data != null && mountValue !== data.settings.mountedMinAccG;

  /** Menor aceleração entre os três eixos da leitura mais recente de cada ponto. */
  const minAcc = (samples: AnalysisResult['vibrationA']): number | null => {
    for (let i = samples.length - 1; i >= 0; i--) {
      const axes = [samples[i].accX, samples[i].accY, samples[i].accZ].filter(
        (v): v is number => v != null,
      );
      if (axes.length) return Math.min(...axes);
    }
    return null;
  };
  const minAccA = data ? minAcc(data.vibrationA) : null;
  const minAccB = data ? minAcc(data.vibrationB) : null;

  /** Temperaturas do par mais recente — a segunda evidência da regra. */
  const tempA = data?.summary.latest?.a ?? data?.seriesA[data.seriesA.length - 1]?.v ?? null;
  const tempB = data?.summary.latest?.b ?? data?.seriesB[data.seriesB.length - 1]?.v ?? null;

  async function saveMount() {
    if (!pinnedPair || !mountValid) return;
    setSaving(true);
    try {
      await setPairSettings(pinnedPair.id, { mountedMinAccG: mountValue });
      setData(await fetchAnalysis(settings));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resetMount() {
    if (!pinnedPair) return;
    setSaving(true);
    try {
      await setPairSettings(pinnedPair.id, { mountedMinAccG: null });
      setData(await fetchAnalysis(settings));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
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

          <section className="card">
            <header>
              <h2>Vibration</h2>
              <div className="axis-switch" role="group" aria-label="Measurement point">
                <button
                  className={`axis-btn${vibPoint === 'A' ? ' is-active' : ''}`}
                  aria-pressed={vibPoint === 'A'}
                  onClick={() => setVibPoint('A')}
                >
                  <i className="dot" style={{ background: 'var(--series-a)' }} />
                  {data.pointA.positionName}
                </button>
                <button
                  className={`axis-btn${vibPoint === 'B' ? ' is-active' : ''}`}
                  aria-pressed={vibPoint === 'B'}
                  onClick={() => setVibPoint('B')}
                >
                  <i className="dot" style={{ background: 'var(--series-b)' }} />
                  {data.pointB.positionName}
                </button>
              </div>
            </header>
            <p className="sub">
              The three machine axes at{' '}
              <strong>
                {vibPoint === 'A' ? data.pointA.positionName : data.pointB.positionName}
              </strong>
              . Both charts share the same point and start at zero.
            </p>
            <div className="legend" style={{ marginBottom: 10 }}>
              {AXES.map((ax) => (
                <span className="legend-item" key={ax.id}>
                  <i className="legend-swatch" style={{ background: ax.color }} />
                  {ax.label}
                </span>
              ))}
            </div>

            <div className="mount-tuner">
              <div className="mount-head">
                <h4>Mounted threshold</h4>
                <span className="picker-hint">
                  A sensor is called off the machine only with both evidences: below this on any
                  axis while the pair vibrates at least twice as much, <em>and</em> at least{' '}
                  {data.settings.offMachineMinTempGapC} °C colder than the pair.
                </span>
              </div>
              <div className="mount-controls">
                <input
                  type="range"
                  min="0.001"
                  max="0.15"
                  step="0.001"
                  value={mountValue}
                  onChange={(e) => setMountDraft(e.target.value)}
                  aria-label="Mounted threshold in g"
                />
                <input
                  className="mount-number"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={mountDraft}
                  onChange={(e) => setMountDraft(e.target.value)}
                />
                <span className="unit">g</span>
                <button
                  className="primary"
                  disabled={!pinnedPair || !mountChanged || !mountValid || saving}
                  onClick={saveMount}
                >
                  {saving ? 'Saving…' : 'Save for this asset'}
                </button>
                {data.settings.mountedIsCustom && (
                  <button disabled={!pinnedPair || saving} onClick={resetMount}>
                    Use default
                  </button>
                )}
              </div>
              <div className="mount-verdict">
                {[
                  { key: 'A' as const, name: data.pointA.positionName, min: minAccA, temp: tempA, color: 'var(--series-a)' },
                  { key: 'B' as const, name: data.pointB.positionName, min: minAccB, temp: tempB, color: 'var(--series-b)' },
                ].map((pt) => {
                  const other = pt.key === 'A' ? minAccB : minAccA;
                  const otherTemp = pt.key === 'A' ? tempB : tempA;
                  const quiet =
                    pt.min != null && other != null &&
                    pt.min < mountValue && other >= mountValue && other >= pt.min * 2;
                  const colder =
                    pt.temp != null && otherTemp != null &&
                    otherTemp - pt.temp >= data.settings.offMachineMinTempGapC;
                  const off = quiet && colder;
                  return (
                    <span key={pt.key} className={`mount-pill${off ? ' is-off' : ''}`}>
                      <i className="dot" style={{ background: pt.color }} />
                      {pt.name}
                      <strong>{pt.min != null ? pt.min.toFixed(4) : '—'} g</strong>
                      {off
                        ? '⚟ off the machine'
                        : quiet
                          ? '⚠ quiet, but not colder enough'
                          : '✓ mounted'}
                    </span>
                  );
                })}
                {!pinnedPair && (
                  <span className="picker-hint">Pin this asset to the board to save a threshold.</span>
                )}
              </div>
            </div>

            <h3 className="chart-title">Acceleration RMS · g</h3>
            <VibrationChart
              series={vibPoint === 'A' ? data.vibrationA : data.vibrationB}
              measure="acc"
              unit="g"
              decimals={3}
              reference={{ value: mountValue, label: `${mountValue} g` }}
            />

            <h3 className="chart-title">Velocity RMS · mm/s</h3>
            <VibrationChart
              series={vibPoint === 'A' ? data.vibrationA : data.vibrationB}
              measure="vel"
              unit="mm/s"
              decimals={2}
            />
          </section>

          <PairTable data={data} />

          <p className="muted" style={{ fontSize: 12 }}>
            {data.diagnostics.samplesA} readings on point A and {data.diagnostics.samplesB} on
            point B · {data.pairs.length} valid comparisons ·{' '}
            {data.diagnostics.discarded} discarded for time lag ·{' '}
            {data.vibrationA.length} vibration samples per point.
          </p>
        </>
      )}
    </>
  );
}
