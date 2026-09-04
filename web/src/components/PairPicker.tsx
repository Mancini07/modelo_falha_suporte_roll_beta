import { useEffect, useMemo, useState } from 'react';
import type { PairState, TreeAsset, TreeFacility } from '../types';
import { suggestPair } from '../suggest';
import { shortName } from '../format.en';

interface Props {
  tree: TreeFacility[];
  /** Pairs already on the board — used to spot duplicates and to edit limits. */
  pinned: PairState[];
  defaultThresholdC: number;
  busy: boolean;
  onPin: (input: {
    facilityName: string;
    asset: TreeAsset;
    pointA: number;
    pointB: number;
    thresholdC: number | null;
  }) => void;
  onUpdateThreshold: (id: string, thresholdC: number | null) => void;
  onLearnBaseline: (id: string, window: { from: string; to: string } | null) => void;
  onDeviationMode: (id: string, mode: 'ABSOLUTE' | 'RELATIVE') => void;
  onClose: () => void;
}

/** ISO date (yyyy-mm-dd) N days back from today. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

interface Row {
  facilityName: string;
  asset: TreeAsset;
}

export default function PairPicker({
  tree, pinned, defaultThresholdC, busy, onPin, onUpdateThreshold, onLearnBaseline,
  onDeviationMode, onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [facility, setFacility] = useState('todas');
  const [selected, setSelected] = useState<Row | null>(null);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  /** Empty string means "use the global default". */
  const [limit, setLimit] = useState('');

  // A janela padrão termina bem antes de hoje: aprender do período recente
  // ensinaria a falha em curso como se fosse o normal da máquina.
  const [baseFrom, setBaseFrom] = useState(daysAgo(30));
  const [baseTo, setBaseTo] = useState(daysAgo(15));

  const pinnedAssetIds = useMemo(() => new Set(pinned.map((p) => p.assetId)), [pinned]);

  const rows = useMemo<Row[]>(
    () => tree.flatMap((f) => f.assets.map((asset) => ({ facilityName: f.facilityName, asset }))),
    [tree],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (facility === 'todas' || r.facilityName === facility) &&
        (q === '' ||
          r.asset.assetName.toLowerCase().includes(q) ||
          r.asset.positions.some((p) => p.positionName.toLowerCase().includes(q))),
    );
  }, [rows, query, facility]);

  // Picking an asset preloads the most likely pair.
  useEffect(() => {
    if (!selected) return;
    const s = suggestPair(selected.asset.positions);
    setA(s ? s.a.positionId : selected.asset.positions[0]?.positionId ?? null);
    setB(s ? s.b.positionId : selected.asset.positions[1]?.positionId ?? null);
  }, [selected]);

  const existing = useMemo(
    () =>
      a != null && b != null
        ? pinned.find(
            (p) =>
              (p.pointA.positionId === a && p.pointB.positionId === b) ||
              (p.pointA.positionId === b && p.pointB.positionId === a),
          ) ?? null
        : null,
    [pinned, a, b],
  );

  // A pinned pair shows the limit it is actually running with.
  useEffect(() => {
    setLimit(existing?.thresholdIsCustom ? String(existing.thresholdC) : '');
  }, [existing]);

  const suggestion = selected ? suggestPair(selected.asset.positions) : null;
  const parsedLimit = limit.trim() === '' ? null : Number(limit);
  const limitValid = parsedLimit == null || (Number.isFinite(parsedLimit) && parsedLimit > 0);
  const canPin = a != null && b != null && a !== b && existing == null && limitValid;

  const limitChanged =
    existing != null &&
    parsedLimit !== (existing.thresholdIsCustom ? existing.thresholdC : null);

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div
        className="picker"
        role="dialog"
        aria-modal="true"
        aria-label="Pin asset to the board"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="picker-head">
          <h2>Pin asset to the board</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="picker-filters">
          <input
            className="picker-search"
            type="search"
            placeholder="Search asset or point…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <select value={facility} onChange={(e) => setFacility(e.target.value)}>
            <option value="todas">All facilities</option>
            {tree.map((f) => (
              <option key={f.facilityId} value={f.facilityName}>
                {f.facilityName} ({f.assets.length})
              </option>
            ))}
          </select>
        </div>

        <div className="picker-body">
          <ul className="picker-list">
            {filtered.length === 0 && <li className="picker-empty">No asset found.</li>}
            {filtered.map((r) => (
              <li key={r.asset.assetId}>
                <button
                  className={`picker-item${selected?.asset.assetId === r.asset.assetId ? ' is-selected' : ''}`}
                  onClick={() => setSelected(r)}
                >
                  <span className="picker-item-name">{r.asset.assetName}</span>
                  <span className="picker-item-meta">
                    {r.facilityName} · {r.asset.positions.length} points
                    {pinnedAssetIds.has(r.asset.assetId) && <em> · already on board</em>}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="picker-detail">
            {!selected ? (
              <p className="muted">Pick an asset on the left to define the pair of points.</p>
            ) : (
              <>
                <h3>{selected.asset.assetName}</h3>
                {suggestion && (
                  <p className="picker-hint">
                    Suggested pair: <strong>{shortName(suggestion.a.positionName)}</strong> vs{' '}
                    <strong>{shortName(suggestion.b.positionName)}</strong> — {suggestion.why}.
                  </p>
                )}

                <div className="picker-points">
                  <div className="field">
                    <label htmlFor="pt-a">
                      <i className="dot" style={{ background: 'var(--series-a)' }} /> Point A
                    </label>
                    <select id="pt-a" value={a ?? ''} onChange={(e) => setA(Number(e.target.value))}>
                      {selected.asset.positions.map((p) => (
                        <option key={p.positionId} value={p.positionId}>{p.positionName}</option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="pt-b">
                      <i className="dot" style={{ background: 'var(--series-b)' }} /> Point B
                    </label>
                    <select id="pt-b" value={b ?? ''} onChange={(e) => setB(Number(e.target.value))}>
                      {selected.asset.positions.map((p) => (
                        <option key={p.positionId} value={p.positionId}>{p.positionName}</option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="pt-limit">Tolerable deviation</label>
                    <input
                      id="pt-limit"
                      type="number"
                      step="0.5"
                      min="0.1"
                      placeholder={`${defaultThresholdC} (default)`}
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                    />
                    <span className="hint">
                      °C — empty uses the {defaultThresholdC} °C default
                    </span>
                  </div>
                </div>

                {a === b && <p className="picker-warn">Pick two different points.</p>}
                {!limitValid && <p className="picker-warn">The limit must be greater than zero.</p>}

                {existing ? (
                  <>
                    <p className="picker-hint">
                      On the board with a <strong>{existing.thresholdC} °C</strong> limit
                      {existing.thresholdIsCustom ? ' set for this asset' : ' from the default'}.
                    </p>
                    <button
                      className="primary picker-pin"
                      disabled={!limitChanged || !limitValid || busy}
                      onClick={() => onUpdateThreshold(existing.id, parsedLimit)}
                    >
                      {busy ? 'Saving…' : 'Update limit'}
                    </button>

                    <div className="picker-baseline">
                      <h4>Deviation measured against</h4>
                      <p className="picker-hint">
                        An asset whose sides are permanently apart alarms all the time under{' '}
                        <strong>zero</strong>. Measuring against its own normal only alarms when
                        the machine departs from what it has always been.
                      </p>
                      <div className="axis-switch">
                        <button
                          className={`axis-btn${existing.deviationMode === 'ABSOLUTE' ? ' is-active' : ''}`}
                          aria-pressed={existing.deviationMode === 'ABSOLUTE'}
                          disabled={busy}
                          onClick={() => onDeviationMode(existing.id, 'ABSOLUTE')}
                        >
                          Zero
                        </button>
                        <button
                          className={`axis-btn${existing.deviationMode === 'RELATIVE' ? ' is-active' : ''}`}
                          aria-pressed={existing.deviationMode === 'RELATIVE'}
                          disabled={busy || existing.baselineC == null}
                          title={
                            existing.baselineC == null
                              ? 'Learn the asset normal below before using it as the reference.'
                              : undefined
                          }
                          onClick={() => onDeviationMode(existing.id, 'RELATIVE')}
                        >
                          Asset normal
                          {existing.baselineC != null &&
                            ` (${existing.baselineC > 0 ? '+' : ''}${existing.baselineC} °C)`}
                        </button>
                      </div>
                      {existing.deviationMode === 'RELATIVE' && existing.baselineC != null && (
                        <p className="picker-hint">
                          Alarms when the deviation leaves{' '}
                          <strong>
                            {(existing.baselineC - existing.thresholdC).toFixed(1)} …{' '}
                            {(existing.baselineC + existing.thresholdC).toFixed(1)} °C
                          </strong>
                          .
                        </p>
                      )}
                    </div>

                    <div className="picker-baseline">
                      <h4>Normal side</h4>
                      <p className="picker-hint">
                        {existing.baselineC != null ? (
                          <>
                            Normally <strong>{existing.baselineC > 0 ? '+' : ''}{existing.baselineC} °C</strong>{' '}
                            ({existing.baselineC > 0 ? 'point A' : 'point B'} hotter). A swap of the
                            hot side raises a <strong>Side inversion</strong> alert.
                          </>
                        ) : (
                          <>
                            Not set — side inversion is not detected for this asset yet.
                            Learn it from a period when the machine was healthy.
                          </>
                        )}
                      </p>

                      <div className="picker-window">
                        <div className="field">
                          <label htmlFor="bl-from">From</label>
                          <input
                            id="bl-from" type="date" value={baseFrom}
                            onChange={(e) => setBaseFrom(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="bl-to">To</label>
                          <input
                            id="bl-to" type="date" value={baseTo}
                            onChange={(e) => setBaseTo(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="picker-actions">
                        <button
                          disabled={busy || !baseFrom || !baseTo || baseFrom >= baseTo}
                          onClick={() =>
                            onLearnBaseline(existing.id, { from: baseFrom, to: baseTo })
                          }
                        >
                          {busy ? 'Learning…' : 'Learn normal from this period'}
                        </button>
                        {existing.baselineC != null && (
                          <button disabled={busy} onClick={() => onLearnBaseline(existing.id, null)}>
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <button
                    className="primary picker-pin"
                    disabled={!canPin || busy}
                    onClick={() =>
                      canPin &&
                      onPin({
                        facilityName: selected.facilityName,
                        asset: selected.asset,
                        pointA: a!,
                        pointB: b!,
                        thresholdC: parsedLimit,
                      })
                    }
                  >
                    {busy ? 'Pinning…' : 'Pin to board'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
