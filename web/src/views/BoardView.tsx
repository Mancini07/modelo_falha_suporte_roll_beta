import { useMemo, useState, type KeyboardEvent } from 'react';
import type { BoardResult, PairAverages, TreeAsset, TreeFacility } from '../types';
import AssetTwin from '../components/AssetTwin';
import PairPicker from '../components/PairPicker';

interface Props {
  board: BoardResult | null;
  averages: Record<string, PairAverages>;
  tree: TreeFacility[];
  busy: boolean;
  error: string | null;
  thresholdC: number;
  toleranceMin: number;
  onTolerance: (v: number) => void;
  onPin: (input: {
    facilityName: string; asset: TreeAsset; pointA: number; pointB: number;
    thresholdC: number | null;
  }) => Promise<void>;
  onUpdateThreshold: (id: string, thresholdC: number | null) => Promise<void>;
  onLearnBaseline: (id: string, window: { from: string; to: string } | null) => Promise<void>;
  onDeviationMode: (id: string, mode: 'ABSOLUTE' | 'RELATIVE') => Promise<void>;
  onRemove: (id: string) => void;
  onAnalyse: (pairId: string) => void;
  onOpenLines: () => void;
}

export default function BoardView({
  board, averages, tree, busy, error, thresholdC, toleranceMin,
  onTolerance, onPin, onUpdateThreshold, onLearnBaseline, onDeviationMode,
  onRemove, onAnalyse, onOpenLines,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALARME' | 'ALERTA' | null>(null);
  const toggleFilter = (s: 'ALARME' | 'ALERTA') =>
    setStatusFilter((cur) => (cur === s ? null : s));
  const filterProps = (s: 'ALARME' | 'ALERTA') => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-pressed': statusFilter === s,
    onClick: () => toggleFilter(s),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFilter(s); }
    },
  });

  const pairs = board?.pairs ?? [];

  const counts = useMemo(
    () => ({
      alarm: pairs.filter((p) => p.status === 'ALARME').length,
      alert: pairs.filter((p) => p.status === 'ALERTA').length,
      normal: pairs.filter((p) => p.status === 'NORMAL').length,
      sensorOff: pairs.filter((p) => p.status === 'SENSOR_FORA').length,
      idle: pairs.filter((p) => p.status === 'SEM_DADOS').length,
    }),
    [pairs],
  );

  const byUnit = useMemo(() => {
    const m = new Map<string, typeof pairs>();
    for (const p of pairs) {
      if (statusFilter && p.status !== statusFilter) continue;
      const k = p.facilityName ?? 'No unit';
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, ps]) => ({
        name,
        pairs: ps,
        alarm: ps.filter((p) => p.status === 'ALARME').length,
        alert: ps.filter((p) => p.status === 'ALERTA').length,
      }));
  }, [pairs, statusFilter]);

  const company = pairs[0]?.companyName ?? 'Fitesa';

  return (
    <>
      <header className="masthead">
        <div>
          <h1>Lubrication failure</h1>
          <p className="breadcrumb">
            <strong>{company}</strong> · {pairs.length} pinned asset{pairs.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="toolbar">
          {/* The limit is set on the server and cannot be changed here. */}
          <span className="chip" title="Default limit. Each asset can carry its own.">
            Default limit {thresholdC} °C
          </span>
          <div className="field field-inline">
            <label htmlFor="tol">Tolerance</label>
            <input
              id="tol" type="number" step="1" min="1" value={toleranceMin}
              onChange={(e) => onTolerance(Number(e.target.value))}
            />
            <span className="unit">min</span>
          </div>
          <button onClick={onOpenLines}>Line overview</button>
          <button className="primary" onClick={() => setPickerOpen(true)}>+ Pin asset</button>
        </div>
      </header>

      <section className="summary" aria-label="Board summary">
        <div
          className={`sum sum-alarm is-clickable${counts.alarm > 0 ? ' is-on' : ''}${statusFilter === 'ALARME' ? ' is-selected' : ''}`}
          title="Click to show only assets at risk"
          {...filterProps('ALARME')}
        >
          <span className="sum-n">{counts.alarm}</span>
          <span className="sum-k">
            ⚠ at risk{board ? ` · ${board.settings.riskHoldHours} h` : ''}
          </span>
        </div>
        <div
          className={`sum sum-alert is-clickable${counts.alert > 0 ? ' is-on' : ''}${statusFilter === 'ALERTA' ? ' is-selected' : ''}`}
          title="Click to show only assets in alert"
          {...filterProps('ALERTA')}
        >
          <span className="sum-n">{counts.alert}</span>
          <span className="sum-k">▲ alert · deviation ≥ 5 °C</span>
        </div>
        <div className="sum sum-ok">
          <span className="sum-n">{counts.normal}</span>
          <span className="sum-k">✓ normal</span>
        </div>
        <div className={`sum sum-sensoroff${counts.sensorOff > 0 ? ' is-on' : ''}`}>
          <span className="sum-n">{counts.sensorOff}</span>
          <span className="sum-k">⚟ sensor off machine</span>
        </div>
        <div className="sum sum-idle">
          <span className="sum-n">{counts.idle}</span>
          <span className="sum-k">— no reading</span>
        </div>
      </section>

      {error && <div className="card error">Error: {error}</div>}
      {busy && !board && <div className="card loading">Loading board…</div>}

      {board && pairs.length === 0 && (
        <div className="card empty">
          <h2>No assets pinned yet</h2>
          <p className="muted">
            Choose the assets and points you want to follow. They stay pinned to the
            board between sessions.
          </p>
          <button className="primary" onClick={() => setPickerOpen(true)}>
            + Pin the first asset
          </button>
        </div>
      )}

      {statusFilter && (
        <p className="muted filter-note">
          Showing only {statusFilter === 'ALARME' ? 'assets at risk' : 'assets in alert'}
          {byUnit.length === 0 && ' — none right now'}.{' '}
          <button onClick={() => setStatusFilter(null)}>Clear filter</button>
        </p>
      )}

      {byUnit.map((u) => (
        <section key={u.name} className="unit-section" aria-label={u.name}>
          <h2 className="unit-head">
            {u.name}
            <span className="unit-meta">
              {u.pairs.length} asset{u.pairs.length === 1 ? '' : 's'}
              {u.alarm > 0 && <span className="unit-alarm"> · ⚠ {u.alarm} at risk</span>}
              {u.alert > 0 && <span className="unit-alert"> · ▲ {u.alert} alert</span>}
            </span>
          </h2>
          <div className="twin-grid">
            {u.pairs.map((p) => (
              <AssetTwin
                key={p.id}
                pair={p}
                averages={averages[p.id]}
                riskHoldHours={board?.settings.riskHoldHours ?? 24}
                mountedMinAccG={board?.settings.mountedMinAccG ?? 0.03}
                onRemove={onRemove}
                onAnalyse={onAnalyse}
                onQuickLimit={(id, v) => onUpdateThreshold(id, v)}
              />
            ))}
          </div>
        </section>
      ))}

      {pickerOpen && (
        <PairPicker
          tree={tree}
          pinned={pairs}
          defaultThresholdC={thresholdC}
          busy={pinning}
          onPin={async (input) => {
            setPinning(true);
            try {
              await onPin(input);
              setPickerOpen(false);
            } finally {
              setPinning(false);
            }
          }}
          onUpdateThreshold={async (id, limit) => {
            setPinning(true);
            try {
              await onUpdateThreshold(id, limit);
              setPickerOpen(false);
            } finally {
              setPinning(false);
            }
          }}
          onLearnBaseline={async (id, window) => {
            setPinning(true);
            try {
              await onLearnBaseline(id, window);
            } finally {
              setPinning(false);
            }
          }}
          onDeviationMode={async (id, mode) => {
            setPinning(true);
            try {
              await onDeviationMode(id, mode);
            } finally {
              setPinning(false);
            }
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
