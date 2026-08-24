import { useState } from 'react';
import type { AnalysisResult } from '../../types';
import { c2, signed, minutes, stampFull } from '../../format.en';

interface Props {
  data: AnalysisResult;
}

/** The tabular view of the same data — identity never rests on chart colour alone. */
export default function PairTable({ data }: Props) {
  const { pairs, pointA, pointB } = data;
  const [onlyAlarms, setOnlyAlarms] = useState(false);

  const rows = (onlyAlarms ? pairs.filter((p) => p.alarm) : pairs).slice().reverse();

  return (
    <section className="card">
      <header>
        <h2>Pair-by-pair comparisons</h2>
        <label className="legend-item" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyAlarms} onChange={(e) => setOnlyAlarms(e.target.checked)} />
          failures only
        </label>
      </header>
      <p className="sub">
        Each row is a moment when both points were measured essentially together. Most recent first.
      </p>

      {rows.length === 0 ? (
        <p className="muted">Nothing to list with the current filter.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">{pointA.positionName}</th>
                <th scope="col">{pointB.positionName}</th>
                <th scope="col">Deviation</th>
                <th scope="col">Lag</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.t} className={p.alarm ? 'is-alarm' : undefined}>
                  <td>{stampFull(p.t)}</td>
                  <td>{c2(p.a)}</td>
                  <td>{c2(p.b)}</td>
                  <td className="delta">{signed(p.delta)}</td>
                  <td className="muted">{minutes(p.lagMs)}</td>
                  <td>
                    {p.alarm
                      ? <span className="tag-alarm">⚠ Lubrication failure</span>
                      : <span className="tag-ok">normal</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
