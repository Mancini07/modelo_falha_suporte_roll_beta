import { useMemo, useState } from 'react';
import type { BoardResult, TreeAsset, TreeFacility } from '../types';
import AssetTwin from '../components/AssetTwin';
import PairPicker from '../components/PairPicker';

interface Props {
  board: BoardResult | null;
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
  onRemove: (id: string) => void;
  onAnalyse: (pairId: string) => void;
}

export default function BoardView({
  board, tree, busy, error, thresholdC, toleranceMin,
  onTolerance, onPin, onUpdateThreshold, onLearnBaseline, onRemove, onAnalyse,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pinning, setPinning] = useState(false);

  const pairs = board?.pairs ?? [];

  const counts = useMemo(
    () => ({
      alarm: pairs.filter((p) => p.status === 'ALARME').length,
      normal: pairs.filter((p) => p.status === 'NORMAL').length,
      sensorOff: pairs.filter((p) => p.status === 'SENSOR_FORA').length,
      idle: pairs.filter((p) => p.status === 'SEM_DADOS').length,
    }),
    [pairs],
  );

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
          <button className="primary" onClick={() => setPickerOpen(true)}>+ Pin asset</button>
        </div>
      </header>

      <section className="summary" aria-label="Board summary">
        <div className={`sum sum-alarm${counts.alarm > 0 ? ' is-on' : ''}`}>
          <span className="sum-n">{counts.alarm}</span>
          <span className="sum-k">
            ⚠ at risk{board ? ` · ${board.settings.riskHoldHours} h` : ''}
          </span>
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

      <div className="twin-grid">
        {pairs.map((p) => (
          <AssetTwin
            key={p.id}
            pair={p}
            riskHoldHours={board?.settings.riskHoldHours ?? 24}
            mountedMinAccG={board?.settings.mountedMinAccG ?? 0.03}
            onRemove={onRemove}
            onAnalyse={onAnalyse}
          />
        ))}
      </div>

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
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
