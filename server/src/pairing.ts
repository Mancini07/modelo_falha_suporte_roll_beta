import type {
  ComparedPair,
  DiscardedSample,
  PairingDiagnostics,
  TempSample,
} from './types.js';

/**
 * Índice da amostra de `b` mais próxima no tempo de `t`, a partir de `from`.
 * As duas séries estão ordenadas, então o cursor só anda para frente.
 */
function advanceToNearest(b: TempSample[], t: number, from: number): number {
  let i = from;
  while (i + 1 < b.length && Math.abs(b[i + 1].t - t) <= Math.abs(b[i].t - t)) {
    i++;
  }
  return i;
}

/**
 * Casa as duas séries por proximidade temporal.
 *
 * Regra do domínio: só faz sentido comparar duas temperaturas se elas foram
 * medidas praticamente no mesmo instante. Cada amostra de A é casada com a
 * amostra de B mais próxima; se a defasagem passar da tolerância, o ponto é
 * descartado em vez de comparado.
 */
export function pairSeries(
  a: TempSample[],
  b: TempSample[],
  toleranceMs: number,
  thresholdC: number,
  /**
   * Desvio de referência, em °C. Zero mede contra a igualdade entre os lados;
   * o normal do ativo mede contra a assimetria que ele sempre teve. Máquinas
   * com um lado permanentemente mais quente só têm alarme útil com o segundo.
   */
  reference = 0,
): { pairs: ComparedPair[]; discarded: DiscardedSample[] } {
  const pairs: ComparedPair[] = [];
  const discarded: DiscardedSample[] = [];
  let cursor = 0;

  for (const sample of a) {
    if (b.length === 0) {
      discarded.push({ t: sample.t, v: sample.v, nearestLagMs: null });
      continue;
    }

    cursor = advanceToNearest(b, sample.t, cursor);
    const match = b[cursor];
    const lagMs = Math.abs(match.t - sample.t);

    if (lagMs > toleranceMs) {
      discarded.push({ t: sample.t, v: sample.v, nearestLagMs: lagMs });
      continue;
    }

    const delta = sample.v - match.v;
    pairs.push({
      t: sample.t,
      tA: sample.t,
      tB: match.t,
      a: sample.v,
      b: match.v,
      lagMs,
      delta,
      alarm: Math.abs(delta - reference) > thresholdC,
    });
  }

  return { pairs, discarded };
}

/** Defasagem até o vizinho mais próximo, para cada amostra de A. */
function nearestLags(a: TempSample[], b: TempSample[]): number[] {
  if (b.length === 0) return [];
  const lags: number[] = [];
  let cursor = 0;
  for (const sample of a) {
    cursor = advanceToNearest(b, sample.t, cursor);
    lags.push(Math.abs(b[cursor].t - sample.t));
  }
  return lags;
}

const CANDIDATE_TOLERANCES_MIN = [1, 2, 3, 5, 6, 8, 10, 15, 20];

/**
 * Explica por que os pares existem (ou não). Sem isso, uma tolerância mal
 * escolhida produz um painel vazio sem nenhuma pista do motivo.
 */
export function diagnose(
  a: TempSample[],
  b: TempSample[],
  pairs: ComparedPair[],
  discarded: DiscardedSample[],
  stopped = 0,
): PairingDiagnostics {
  const lags = nearestLags(a, b);
  const sorted = [...lags].sort((x, y) => x - y);

  return {
    samplesA: a.length,
    samplesB: b.length,
    paired: pairs.length,
    discarded: discarded.length,
    stopped,
    minLagMs: sorted.length ? sorted[0] : null,
    medianLagMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    yieldByToleranceMin: CANDIDATE_TOLERANCES_MIN.map((toleranceMin) => ({
      toleranceMin,
      pairs: lags.filter((l) => l <= toleranceMin * 60_000).length,
    })),
  };
}

/**
 * Há quanto tempo o desvio está continuamente acima do limite.
 * Um pico isolado é ruído; um desvio sustentado é falha de lubrificação.
 */
export function alarmStreakMs(pairs: ComparedPair[]): number | null {
  if (pairs.length === 0 || !pairs[pairs.length - 1].alarm) return null;

  const latest = pairs[pairs.length - 1];
  let start = latest.t;
  for (let i = pairs.length - 1; i >= 0; i--) {
    if (!pairs[i].alarm) break;
    start = pairs[i].t;
  }
  return latest.t - start;
}

export function summarize(pairs: ComparedPair[], thresholdC: number) {
  if (pairs.length === 0) {
    return {
      latest: null,
      status: 'SEM_DADOS' as const,
      alarmCount: 0,
      alarmRatio: 0,
      maxAbsDelta: null,
      avgAbsDelta: null,
      alarmStreakMs: null,
    };
  }

  const abs = pairs.map((p) => Math.abs(p.delta));
  const alarmCount = pairs.filter((p) => p.alarm).length;
  const latest = pairs[pairs.length - 1];

  return {
    latest,
    status: latest.alarm ? ('ALARME' as const) : ('NORMAL' as const),
    alarmCount,
    alarmRatio: alarmCount / pairs.length,
    maxAbsDelta: Math.max(...abs),
    avgAbsDelta: abs.reduce((s, x) => s + x, 0) / abs.length,
    alarmStreakMs: alarmStreakMs(pairs),
  };
}
