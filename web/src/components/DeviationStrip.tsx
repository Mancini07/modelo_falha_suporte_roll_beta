import type { PairAverages, PairState } from '../types';
import { signed1, shortName } from '../format.en';

/**
 * Barra de desvio e médias de 7/15/30 dias.
 *
 * A barra segue a geometria do twin: o ponto A fica à esquerda e o B à direita,
 * e ela cresce a partir do centro PARA O LADO MAIS QUENTE. A faixa verde é a
 * tolerada (referência ± limite); passando dela, a barra fica vermelha.
 */
export default function DeviationStrip({
  pair, averages,
}: { pair: PairState; averages?: PairAverages }) {
  if (pair.delta == null || pair.status === 'SENSOR_FORA') return null;

  const limit = pair.thresholdC;
  const ref = pair.deviationReference;
  const span = limit * 2; // meia-largura da barra: 2× o limite
  const clamp = (v: number) => Math.max(-span, Math.min(span, v));
  // delta = A − B: positivo é A mais quente, e A está à esquerda.
  const pos = (d: number) => 50 - (clamp(d) / span) * 50;
  const dev = pair.delta - ref;
  const out = Math.abs(dev) > limit;

  const fillLeft = Math.min(50, pos(dev));
  const fillWidth = Math.abs(pos(dev) - 50);

  const nameA = shortName(pair.pointA.name);
  const nameB = shortName(pair.pointB.name);

  const drift = pair.driftCPerH;
  const eta = pair.etaBreachMin;
  const etaText = eta == null ? null : eta >= 60 ? `~${(eta / 60).toFixed(1)} h` : `~${eta} min`;

  const rows: { label: string; avg: number | null | undefined; n: number | undefined }[] = [
    { label: '6 h', avg: pair.avg6h, n: pair.n6h },
    { label: '7 d', avg: averages?.d7, n: averages?.n7 },
    { label: '15 d', avg: averages?.d15, n: averages?.n15 },
    { label: '30 d', avg: averages?.d30, n: averages?.n30 },
  ];

  return (
    <div className={`dstrip${out ? ' is-out' : ''}`}>
      <div className="gauge" role="img"
        aria-label={`Deviation ${signed1(dev)} degrees, ${dev > 0 ? nameA : nameB} is hotter, limit ${limit}.`}>
        <span className="gauge-safe" style={{ left: `${pos(limit)}%`, width: `${pos(-limit) - pos(limit)}%` }} />
        <span className="gauge-fill" style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }} />
        <span className="gauge-mid" />
        <span className="gauge-needle" style={{ left: `${pos(dev)}%` }} />
      </div>
      <div className="gauge-scale">
        <span className={dev > 0 ? 'is-hot' : undefined}>◀ {nameA}</span>
        <span className="gauge-ref">{ref !== 0 ? `normal ${signed1(ref)}` : 'equal'}</span>
        <span className={dev < 0 ? 'is-hot' : undefined}>{nameB} ▶</span>
      </div>

      {drift != null && eta != null && (
        <p className="drift">
          <span className={`drift-arrow${Math.abs(drift) < 0.1 ? ' is-flat' : drift > 0 ? ' is-up' : ' is-down'}`}>
            {Math.abs(drift) < 0.1 ? '→' : drift > 0 ? '↗' : '↘'}
          </span>
          {Math.abs(drift) < 0.1 ? 'Stable' : `${signed1(drift)} °C/h over 3 h`}
          {etaText && <strong className="drift-eta"> · reaches the limit in {etaText}</strong>}
        </p>
      )}

      <div className="avgs" aria-label="Average deviation by period">
        {rows.map((r) => {
          const breach = r.avg != null && Math.abs(r.avg - ref) > limit;
          return (
            <div key={r.label} className={`avg${breach ? ' is-out' : ''}`}
              title={r.n != null ? `${r.n} comparisons` : undefined}>
              <span className="avg-k">{r.label}</span>
              <span className="avg-v">{r.avg == null ? (r.label === '6 h' || averages ? '—' : '…') : signed1(r.avg)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
