import { useEffect, useMemo, useState } from 'react';
import { fetchLine, fetchLines } from '../api';
import type { LineDetail, LinePoint, LineSummary, PointSide } from '../types';
import { c1, shortName, stampAgo } from '../format.en';

interface Props {
  companyId: number;
  onBack: () => void;
}

const SIDES: Array<{ id: PointSide; label: string; hint: string }> = [
  { id: 'DRIVE', label: 'Drive side', hint: 'the drive-side bearing of every roll' },
  { id: 'OPPOSITE', label: 'Opposite side', hint: 'the opposite-side bearing of every roll' },
  // Nem toda planta nomeia o lado: em Gravataí os pontos são "Mancal LE/LD" e
  // "Eixo de Entrada/Saída", que não dizem lado motriz. Vão todos para cá.
  { id: 'SINGLE', label: 'Side not named', hint: 'roll points whose name does not say which side they sit on' },
];

/**
 * Uma leitura velha não compara com nada: o ponto pode ter parado de reportar
 * temperatura meses atrás enquanto a vibração seguiu viva. Fora da mediana.
 */
const STALE_MS = 24 * 60 * 60 * 1000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Uma linha é identificada pela unidade + prefixo: "SC1" só é único dentro da planta. */
type LineKey = { facilityId: number; line: string };

const keyOf = (l: LineKey) => `${l.facilityId}:${l.line}`;

/**
 * Os rolos de uma linha, agrupados pelo lado da máquina.
 *
 * Comparar o mesmo lado entre rolos diferentes é um sinal por si só: se todos
 * os mancais do lado motriz da linha rodam perto de 46 °C e um roda a 60, esse
 * um se denuncia sem precisar de par. Só rolos entram: bomba, motor e redutor
 * trabalham em outro patamar térmico e puxariam a mediana do grupo.
 */
export default function LineView({ companyId, onBack }: Props) {
  const [lines, setLines] = useState<LineSummary[]>([]);
  const [selected, setSelected] = useState<LineKey | null>(null);
  const [detail, setDetail] = useState<LineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Quanto acima da mediana do grupo um ponto precisa estar para se destacar. */
  const [spreadC, setSpreadC] = useState(5);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLines(companyId, ctrl.signal)
      .then((r) => {
        setLines(r);
        // Abre na linha mais instrumentada: é onde a comparação rende mais.
        const richest = [...r].sort((a, b) => b.points - a.points)[0];
        setSelected((cur) => cur ?? (richest ? { facilityId: richest.facilityId, line: richest.line } : null));
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => ctrl.abort();
  }, [companyId]);

  useEffect(() => {
    if (!selected) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchLine(companyId, selected.facilityId, selected.line, ctrl.signal)
      .then(setDetail)
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [companyId, selected?.facilityId, selected?.line]);

  const groups = useMemo(() => {
    const byside = new Map<PointSide, LinePoint[]>();
    for (const s of SIDES) byside.set(s.id, []);
    for (const p of detail?.points ?? []) byside.get(p.side)?.push(p);
    return byside;
  }, [detail]);

  // Recalculado a cada render: basta para decidir o que é leitura velha.
  const now = Date.now();

  const current = selected
    ? lines.find((l) => l.facilityId === selected.facilityId && l.line === selected.line)
    : undefined;

  // As abas vêm agrupadas por unidade: a mesma sigla de linha pode existir em
  // duas plantas, e comparar rolos de plantas diferentes não diria nada.
  const byFacility = useMemo(() => {
    const map = new Map<number, { name: string; lines: LineSummary[] }>();
    for (const l of lines) {
      const entry = map.get(l.facilityId) ?? { name: l.facilityName, lines: [] };
      entry.lines.push(l);
      map.set(l.facilityId, entry);
    }
    return [...map.entries()];
  }, [lines]);

  return (
    <>
      <header className="masthead">
        <div>
          <button className="back-link" onClick={onBack}>← Back to board</button>
          <h1>Line overview</h1>
          <p className="breadcrumb">
            {current ? (
              <>
                <strong>{current.line}</strong> · {current.facilityName} · {current.assets} rolls ·{' '}
                {current.points} points
              </>
            ) : (
              'Pick a line'
            )}
          </p>
        </div>
        <div className="toolbar">
          <div className="field field-inline">
            <label htmlFor="spread">Flag above median by</label>
            <input
              id="spread" type="number" step="0.5" min="0.5" value={spreadC}
              onChange={(e) => setSpreadC(Number(e.target.value) || 0.5)}
            />
            <span className="unit">°C</span>
          </div>
        </div>
      </header>

      <div className="line-nav">
        {byFacility.map(([facilityId, group]) => (
          <nav className="line-facility" key={facilityId} aria-label={`Lines at ${group.name}`}>
            <h2>{group.name}</h2>
            <div className="line-tabs">
              {group.lines.map((l) => {
                const active = selected != null && keyOf(selected) === keyOf(l);
                return (
                  <button
                    key={keyOf(l)}
                    className={`line-tab${active ? ' is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setSelected({ facilityId: l.facilityId, line: l.line })}
                  >
                    {l.line}
                    <em>{l.points}</em>
                  </button>
                );
              })}
            </div>
          </nav>
        ))}
      </div>

      {error && <div className="card error">Failed to load: {error}</div>}
      {loading && !detail && <div className="card loading">Loading line…</div>}

      {detail && (
        <div className="line-groups">
          {SIDES.map((side) => {
            const all = groups.get(side.id) ?? [];
            const withTemp = all
              .filter((p): p is LinePoint & { temp: number } => p.temp != null)
              .sort((a, b) => b.temp - a.temp);
            const fresh = withTemp.filter(
              (p) => p.at != null && now - new Date(p.at).getTime() < STALE_MS,
            );
            if (fresh.length === 0) return null;

            const med = median(fresh.map((p) => p.temp))!;
            const max = fresh[0].temp;
            const min = fresh[fresh.length - 1].temp;
            // A barra usa a faixa do grupo, não zero: aqui interessa a posição
            // relativa entre irmãos, e uma base em zero achataria tudo.
            const span = Math.max(max - min, 1);

            return (
              <section className="card line-group" key={side.id}>
                <header>
                  <h2>{side.label}</h2>
                  <span className="chip">
                    {fresh.length} points · median {c1(med)}
                  </span>
                </header>
                <p className="sub">{side.hint}. Sorted hottest first.</p>

                <ul className="line-list">
                  {withTemp.map((p) => {
                    const stale = p.at == null || now - new Date(p.at).getTime() >= STALE_MS;
                    const delta = p.temp - med;
                    const hot = !stale && delta >= spreadC;
                    const pct = ((p.temp - min) / span) * 100;
                    return (
                      <li
                        key={p.positionId}
                        className={`line-row${hot ? ' is-hot' : ''}${stale ? ' is-stale' : ''}`}
                      >
                        {/* O nome do ponto se repete entre máquinas ("01.1 -
                            Motor LA"), então o ativo precisa vir junto para a
                            linha identificar de qual máquina se trata. */}
                        <span className="line-name">
                          <b>{p.assetName}</b>
                          <em>{shortName(p.positionName)}</em>
                          {p.pinned && <i className="line-pinned" title="Pinned on the board">●</i>}
                        </span>
                        <span className="line-bar">
                          <span className="line-bar-fill" style={{ width: `${Math.max(pct, 2)}%` }} />
                        </span>
                        <span className="line-temp">{c1(p.temp)}</span>
                        <span className="line-delta">
                          {stale ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(1)}`}
                        </span>
                        <span className="line-when">{p.at ? stampAgo(new Date(p.at).getTime()) : '—'}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
