import { config } from './config.js';
import { getTemperatureSeries, getVibrationSeries } from './dynamo.js';
import { getPositions, getOpenOccurrences } from './postgres.js';
import { pairSeries } from './pairing.js';
import type { PinnedPair } from './pairsStore.js';
import type { BoardResult, ComparedPair, PairState, VibrationSample } from './types.js';

/**
 * Janela de risco. Um rompimento do limite mantém o ativo em risco por este
 * período: a temperatura oscila, e um ativo que voltou para dentro do limite
 * na última leitura não deixou de merecer atenção. Também é a janela lida do
 * histórico.
 */
export const RISK_HOLD_HOURS = 24;
const WINDOW_MS = RISK_HOLD_HOURS * 60 * 60 * 1000;

/**
 * O lado quente trocou de lugar?
 *
 * Só conta como inversão se o desvio mudou de sinal em relação ao normal do
 * ativo E o giro foi maior que a tolerância dele. Sem essa segunda condição,
 * um ativo cujo normal é próximo de zero acusaria inversão a cada oscilação.
 */
/**
 * Menor aceleração RMS entre os três eixos da leitura mais recente.
 *
 * É o mínimo, e não o máximo: basta UM eixo apagado para denunciar um sensor
 * que não está acoplado à máquina. Um sensor bem montado vibra nos três.
 */
export function minAcceleration(series: VibrationSample[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const axes = [series[i].accX, series[i].accY, series[i].accZ].filter(
      (v): v is number => v != null,
    );
    if (axes.length) return Math.min(...axes);
  }
  return null;
}

/**
 * Quanto o par precisa vibrar a mais para o sensor quieto contar como solto.
 *
 * Sem isso, dois sensores igualmente montados numa máquina de baixa vibração
 * caem em lados opostos da linha por milésimos de g — um marcado como solto,
 * o outro não. A diferença precisa ser de natureza, não de arredondamento.
 */
const OFF_MACHINE_RATIO = 2;

/**
 * Um sensor está fora da máquina quando DUAS evidências independentes apontam
 * para isso:
 *
 * 1. Vibração — ele está abaixo do mínimo enquanto o par, no mesmo ativo, está
 *    acima e vibrando pelo menos o dobro. Com os dois parados quem está
 *    desligada é a máquina, e nenhum sensor caiu.
 * 2. Temperatura — ele está bem mais frio que o par. Um sensor solto lê o
 *    ambiente, não o mancal; se as duas temperaturas estão próximas, o sensor
 *    provavelmente ainda está na máquina e a suspeita não se sustenta.
 *
 * Sem as duas, nada é declarado e o ativo continua sendo avaliado por
 * lubrificação — errar para o lado de manter o alarme, não de silenciá-lo.
 */
export function offMachine(args: {
  minSelf: number | null;
  minOther: number | null;
  minG: number;
  tempSelf: number | null;
  tempOther: number | null;
  minTempGapC: number;
}) {
  const { minSelf, minOther, minG, tempSelf, tempOther, minTempGapC } = args;

  if (minSelf == null || minOther == null) return false;
  if (minSelf >= minG || minOther < minG) return false;
  if (minOther < minSelf * OFF_MACHINE_RATIO) return false;

  // Sem as duas temperaturas não há como confirmar; não declara.
  if (tempSelf == null || tempOther == null) return false;
  return tempOther - tempSelf >= minTempGapC;
}

/** Maior aceleração entre os três eixos de uma amostra. */
function maxAcc(s: VibrationSample | null): number | null {
  if (!s) return null;
  const axes = [s.accX, s.accY, s.accZ].filter((v): v is number => v != null);
  return axes.length ? Math.max(...axes) : null;
}

/** Amostra de vibração mais próxima de um instante, dentro da tolerância. */
function nearestVibration(
  series: VibrationSample[],
  t: number,
  tolMs: number,
): VibrationSample | null {
  let best: VibrationSample | null = null;
  let bestDist = Infinity;
  for (const s of series) {
    const d = Math.abs(s.t - t);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return bestDist <= tolMs ? best : null;
}

/** Quanto antes da amostra de "parada" o desligamento já esquenta o mancal. */
const STOP_LOOKAHEAD_MS = 90 * 60_000;
/** Quanto depois da parada os lados ainda estão se igualando. */
const STOP_LOOKBACK_MS = 60 * 60_000;

/**
 * Descarta as comparações feitas com a máquina parada — e as da transição de
 * desligamento/religamento, onde a temperatura sobe sem refrigeração e o desvio
 * cresce sem ser falha de lubrificação.
 *
 * Parada, os mancais esfriam em ritmos diferentes e o desvio entre os lados
 * passa a refletir inércia térmica, não lubrificação. A vibração é horária, daí
 * a tolerância de 90 min para casar com a leitura de temperatura.
 *
 * Sem vibração por perto a comparação é mantida: não dá para provar que estava
 * parada, e descartar dado bom é pior que manter dado duvidoso.
 */
export function dropStopped(
  pairs: ComparedPair[],
  vibA: VibrationSample[],
  vibB: VibrationSample[],
  runningMinAccG: number,
): { running: ComparedPair[]; stopped: number } {
  const TOL = 90 * 60_000;

  /** A máquina está parada neste instante? null = sem vibração por perto. */
  const stoppedAt = (t: number): boolean | null => {
    const a = maxAcc(nearestVibration(vibA, t, TOL));
    const b = maxAcc(nearestVibration(vibB, t, TOL));
    if (a == null && b == null) return null;
    // Basta um dos lados acusar movimento para a máquina estar rodando.
    return Math.max(a ?? 0, b ?? 0) < runningMinAccG;
  };

  // Instantes de vibração em que a máquina estava parada.
  const stopTimes = [...vibA, ...vibB]
    .map((v) => v.t)
    .filter((t) => stoppedAt(t) === true)
    .sort((x, y) => x - y);

  const running: ComparedPair[] = [];
  let stopped = 0;

  for (const p of pairs) {
    const now = stoppedAt(p.t);
    if (now === null) { running.push(p); continue; }
    // Transição de parada: ao desligar, o mancal segue aquecendo sem a
    // refrigeração do giro, e ao religar os lados demoram a se igualar. A
    // vibração é horária, então a parada só aparece na amostra seguinte — por
    // isso se olha para a frente (até 90 min) e para trás (até 60 min).
    const nearStop =
      now ||
      stopTimes.some((st) => st - p.t <= STOP_LOOKAHEAD_MS && p.t - st <= STOP_LOOKBACK_MS);
    if (nearStop) stopped++;
    else running.push(p);
  }
  return { running, stopped };
}

/**
 * Inclinação do desvio nas últimas 3 h e tempo estimado até o limite.
 * A inclinação permite avisar ANTES do rompimento — a falha de lubrificação
 * costuma subir de forma gradual, e o alarme de limite só fala depois.
 */
export function trendOf(pairs: ComparedPair[], reference: number, thresholdC: number) {
  const pts = pairs.map((p) => ({ t: p.t, d: p.delta - reference }));

  const last = pts[pts.length - 1];
  const recent = last ? pts.filter((p) => p.t >= last.t - 3 * 3_600_000) : [];
  if (recent.length < 4 || recent[recent.length - 1].t - recent[0].t < 3_600_000) {
    return { driftCPerH: null, etaBreachMin: null };
  }
  const n = recent.length;
  const mt = recent.reduce((s, p) => s + p.t, 0) / n;
  const md = recent.reduce((s, p) => s + p.d, 0) / n;
  let num = 0, den = 0;
  for (const p of recent) { num += (p.t - mt) * (p.d - md); den += (p.t - mt) ** 2; }
  const driftCPerH = den === 0 ? 0 : (num / den) * 3_600_000;

  let etaBreachMin: number | null = null;
  if (Math.abs(last.d) <= thresholdC && Math.abs(driftCPerH) >= 0.1) {
    const bound = driftCPerH > 0 ? thresholdC : -thresholdC;
    const hours = (bound - last.d) / driftCPerH;
    if (hours > 0 && hours <= 12) etaBreachMin = Math.round(hours * 60);
  }
  return { driftCPerH, etaBreachMin };
}

const DAY_MS = 24 * 3_600_000;
const AVG_TTL_MS = 10 * 60_000;
const avgCache = new Map<string, { at: number; value: PairAverages }>();

export interface PairAverages {
  /** desvio médio (a − b, com sinal) por janela; null sem comparações */
  d7: number | null;
  d15: number | null;
  d30: number | null;
  /** quantas comparações entraram em cada média */
  n7: number;
  n15: number;
  n30: number;
  /** percentil 95, nas últimas 72 h, da menor aceleração entre os eixos de cada ponto (g) */
  stillAccA: number | null;
  stillAccB: number | null;
  /** aceleração mínima de montado aplicada a este par */
  mountedMinAccG: number;
  /** o ponto está parado há 3 dias ou mais enquanto o outro do ativo vibra */
  possiblyOffA: boolean;
  possiblyOffB: boolean;
}

/**
 * Quão parado esteve o ponto nas últimas 72 h, pela menor aceleração entre os
 * eixos de cada leitura (vibração é horária). A média esconde o problema: poucas
 * leituras altas puxam o número para cima e um sensor parado parece vivo. Por
 * isso `high` é o percentil 95 — se até ele está abaixo do mínimo, praticamente
 * toda leitura dos 3 dias estava parada — e `typical` é a mediana.
 * null quando há poucas leituras para sustentar a conclusão.
 */
const STILL_WINDOW_MS = 3 * DAY_MS;
const STILL_MIN_SAMPLES = 24;
function stillness(series: VibrationSample[], now: number) {
  const mins: number[] = [];
  for (const s of series) {
    if (s.t < now - STILL_WINDOW_MS) continue;
    const axes = [s.accX, s.accY, s.accZ].filter((v): v is number => v != null);
    if (axes.length) mins.push(Math.min(...axes));
  }
  if (mins.length < STILL_MIN_SAMPLES) return null;
  mins.sort((x, y) => x - y);
  const at = (q: number) => mins[Math.min(mins.length - 1, Math.floor(q * (mins.length - 1)))];
  return { high: at(0.95), typical: at(0.5) };
}

/**
 * Desvio médio dos últimos 7, 15 e 30 dias de cada par cravado.
 *
 * Leitura de 30 dias é pesada para o ciclo de 60 s do painel, então fica em
 * rota própria com cache de 10 min. Comparações com a máquina parada são
 * descartadas, como no resto da análise.
 */
export async function evaluateAverages(
  pinned: PinnedPair[],
  toleranceMs: number,
): Promise<Record<string, PairAverages>> {
  const now = Date.now();
  const since = now - 30 * DAY_MS;
  const ids = [...new Set(pinned.flatMap((p) => [p.pointA, p.pointB]))];
  const meta = ids.length ? await getPositions(ids) : new Map();

  const out: Record<string, PairAverages> = {};
  await Promise.all(
    pinned.map(async (pin) => {
      const key = `${pin.id}:${toleranceMs}`;
      const hit = avgCache.get(key);
      if (hit && now - hit.at < AVG_TTL_MS) { out[pin.id] = hit.value; return; }
      try {
        const infoA = meta.get(pin.pointA);
        const infoB = meta.get(pin.pointB);
        const [a, b, vibA, vibB] = await Promise.all([
          getTemperatureSeries(pin.pointA, since),
          getTemperatureSeries(pin.pointB, since),
          infoA?.activatorId ? getVibrationSeries(infoA.activatorId, since) : Promise.resolve([]),
          infoB?.activatorId ? getVibrationSeries(infoB.activatorId, since) : Promise.resolve([]),
        ]);
        const { pairs: all } = pairSeries(a, b, toleranceMs, Infinity);
        const { running } = dropStopped(all, vibA, vibB, config.runningMinAccG);

        const mean = (days: number) => {
          const xs = running.filter((p) => p.t >= now - days * DAY_MS).map((p) => p.delta);
          return { avg: xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null, n: xs.length };
        };
        const m7 = mean(7), m15 = mean(15), m30 = mean(30);
        // Parado há 3 dias enquanto o par do mesmo ativo vibra: se a máquina
        // estivesse parada, os dois estariam; logo o sensor não deve estar nela.
        const minG = pin.mountedMinAccG ?? config.mountedMinAccG;
        const stA = stillness(vibA, now);
        const stB = stillness(vibB, now);
        const stillAccA = stA?.high ?? null;
        const stillAccB = stB?.high ?? null;
        // Segunda evidência, a mesma da regra de sensor fora da máquina: um sensor
        // solto lê o ambiente. Se a temperatura dele está próxima da do par, ele
        // está num mancal quente — só vibra pouco — e o aviso não se sustenta.
        const tA = a[a.length - 1]?.v ?? null;
        const tB = b[b.length - 1]?.v ?? null;
        const gap = config.offMachineMinTempGapC;
        const coldA = tA != null && tB != null && tB - tA >= gap;
        const coldB = tA != null && tB != null && tA - tB >= gap;
        const possiblyOffA = stA != null && stB != null && stA.high < minG && stB.typical >= minG && coldA;
        const possiblyOffB = stA != null && stB != null && stB.high < minG && stA.typical >= minG && coldB;
        const value: PairAverages = {
          d7: m7.avg, d15: m15.avg, d30: m30.avg, n7: m7.n, n15: m15.n, n30: m30.n,
          stillAccA, stillAccB, mountedMinAccG: minG, possiblyOffA, possiblyOffB,
        };
        avgCache.set(key, { at: now, value });
        out[pin.id] = value;
      } catch (err) {
        console.error('[averages]', pin.id, (err as Error).message);
      }
    }),
  );
  return out;
}

/** Desvio médio (com sinal) das últimas `hours` horas, sobre as comparações válidas. */
function recentMean(pairs: ComparedPair[], hours: number) {
  const from = Date.now() - hours * 3_600_000;
  const xs = pairs.filter((p) => p.t >= from).map((p) => p.delta);
  return {
    avg6h: xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null,
    n6h: xs.length,
  };
}

export function isInverted(
  delta: number,
  baselineC: number | null,
  thresholdC: number,
): boolean {
  if (baselineC == null) return false;
  const sd = Math.sign(delta);
  const sb = Math.sign(baselineC);
  if (sd === 0 || sb === 0 || sd === sb) return false;
  return Math.abs(delta - baselineC) > thresholdC;
}

/** Mediana — resiste a picos isolados melhor que a média. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Aprende o desvio normal de um par a partir de uma janela escolhida pelo
 * usuário — de propósito, e não dos últimos dias: se a falha já começou,
 * aprender do período recente ensinaria a falha como se fosse o normal.
 */
export async function learnBaseline(
  pointA: number,
  pointB: number,
  fromMs: number,
  toMs: number,
  toleranceMs: number,
): Promise<{ baselineC: number; samples: number } | null> {
  const [a, b] = await Promise.all([
    getTemperatureSeries(pointA, fromMs, toMs),
    getTemperatureSeries(pointB, fromMs, toMs),
  ]);
  // O limite não influencia o cálculo, só o campo `alarm` que aqui é ignorado.
  const { pairs } = pairSeries(a, b, toleranceMs, Infinity);
  const value = median(pairs.map((p) => p.delta));
  return value == null ? null : { baselineC: value, samples: pairs.length };
}

export async function evaluateBoard(
  pinned: PinnedPair[],
  defaultThresholdC: number,
  toleranceMs: number,
): Promise<BoardResult> {
  const since = Date.now() - WINDOW_MS;

  // Metadados de todos os pontos numa consulta só.
  const ids = [...new Set(pinned.flatMap((p) => [p.pointA, p.pointB]))];
  const meta = ids.length ? await getPositions(ids) : new Map();

  // Ocorrências são do ATIVO, não do par de sensores: valem mesmo quando a
  // comparação de temperatura está suspensa.
  const assetIds = [...new Set(pinned.map((p) => p.assetId).filter((id) => id > 0))];
  const occurrences = await getOpenOccurrences(assetIds);

  const states = await Promise.all(
    pinned.map(async (pin): Promise<PairState> => {
      const infoA = meta.get(pin.pointA);
      const infoB = meta.get(pin.pointB);

      // Cada ativo tem sua assimetria normal entre mancais: um redutor grande
      // tolera mais desvio que um rolo leve. O limite do par manda; o global
      // é só o ponto de partida.
      /**
       * Ativo com assimetria permanente entre os lados só tem alarme útil se o
       * desvio for medido contra esse normal, e não contra zero.
       */
      const deviationMode = pin.deviationMode ?? 'ABSOLUTE';
      const deviationReference =
        deviationMode === 'RELATIVE' ? (pin.baselineC ?? 0) : 0;

      const thresholdIsCustom = pin.thresholdC != null;
      const thresholdC = pin.thresholdC ?? defaultThresholdC;
      const baselineC = pin.baselineC ?? null;

      const occ = occurrences.get(pin.assetId) ?? null;

      const base = {
        id: pin.id,
        assetId: pin.assetId,
        assetName: infoA?.assetName ?? pin.assetName,
        facilityName: infoA?.facilityName ?? pin.facilityName,
        companyName: infoA?.companyName ?? null,
        label: pin.label,
        thresholdC,
        thresholdIsCustom,
        baselineC,
        deviationMode,
        deviationReference,
        openOccurrences: occ?.openCount ?? 0,
        occurrenceStatus: occ?.worstStatus ?? null,
        occurrenceStatusId: occ?.worstStatusId ?? null,
        occurrenceOpenedAt: occ?.oldestOpenedAt ?? null,
      };

      try {
        const [a, b, vibA, vibB] = await Promise.all([
          getTemperatureSeries(pin.pointA, since),
          getTemperatureSeries(pin.pointB, since),
          infoA?.activatorId ? getVibrationSeries(infoA.activatorId, since) : Promise.resolve([]),
          infoB?.activatorId ? getVibrationSeries(infoB.activatorId, since) : Promise.resolve([]),
        ]);

        const all = pairSeries(a, b, toleranceMs, thresholdC, deviationReference).pairs;
        const { running: pairs } = dropStopped(all, vibA, vibB, config.runningMinAccG);
        const latest = pairs[pairs.length - 1];
        const trendInfo = trendOf(pairs, deviationReference, thresholdC);

        // Basta um rompimento na janela para o ativo seguir em risco.
        const breaches = pairs.filter((p) => p.alarm);
        const lastBreachAt = breaches.length ? breaches[breaches.length - 1].t : null;

        // Sensor solto invalida a comparação: a temperatura dele é do ambiente.
        const peakAccA = minAcceleration(vibA);
        const peakAccB = minAcceleration(vibB);
        // Cada ativo pode ter seu próprio mínimo: máquinas vibram diferente.
        const mountedIsCustom = pin.mountedMinAccG != null;
        const minG = pin.mountedMinAccG ?? config.mountedMinAccG;
        // As temperaturas do par simultâneo; sem par válido, as últimas lidas.
        const tempA = latest ? latest.a : (a[a.length - 1]?.v ?? null);
        const tempB = latest ? latest.b : (b[b.length - 1]?.v ?? null);
        const minTempGapC = config.offMachineMinTempGapC;

        const offA = offMachine({
          minSelf: peakAccA, minOther: peakAccB, minG,
          tempSelf: tempA, tempOther: tempB, minTempGapC,
        });
        const offB = offMachine({
          minSelf: peakAccB, minOther: peakAccA, minG,
          tempSelf: tempB, tempOther: tempA, minTempGapC,
        });
        const anyOff = offA || offB;


        const lastA = a[a.length - 1] ?? null;
        const lastB = b[b.length - 1] ?? null;

        // Sem par válido, ainda mostramos a última leitura de cada lado — com o
        // horário dela, que é justamente o que revela um sensor atrasado.
        const pointA = {
          positionId: pin.pointA,
          name: infoA?.positionName ?? `Ponto ${pin.pointA}`,
          temp: latest ? latest.a : lastA?.v ?? null,
          t: latest ? latest.tA : lastA?.t ?? null,
        };
        const pointB = {
          positionId: pin.pointB,
          name: infoB?.positionName ?? `Ponto ${pin.pointB}`,
          temp: latest ? latest.b : lastB?.v ?? null,
          t: latest ? latest.tB : lastB?.t ?? null,
        };

        const sensorFlags = {
          offMachineA: offA,
          offMachineB: offB,
          peakAccA,
          peakAccB,
          mountedMinAccG: minG,
          mountedIsCustom,
        };

        if (!latest) {
          return {
            ...base,
            ...sensorFlags,
            pointA,
            pointB,
            delta: null,
            t: null,
            lagMs: null,
            status: anyOff ? 'SENSOR_FORA' : 'SEM_DADOS',
            inverted: false,
            breachCount: 0,
            lastBreachAt: null,
            heldByRecentBreach: false,
            hotter: null,
            reason:
              a.length === 0 || b.length === 0
                ? 'One of the points has not transmitted in the last 12 h.'
                : 'No simultaneous readings within the tolerance.',
          };
        }

        return {
          ...base,
          ...sensorFlags,
          pointA,
          pointB,
          delta: latest.delta,
          t: latest.t,
          lagMs: latest.lagMs,
          status: anyOff
            ? 'SENSOR_FORA'
            : latest.alarm || breaches.length > 0
              ? 'ALARME'
              : Math.abs(latest.delta - deviationReference) >= config.defaults.alertC
                ? 'ALERTA'
                : 'NORMAL',
          inverted: anyOff ? false : isInverted(latest.delta, baselineC, thresholdC),
          breachCount: anyOff ? 0 : breaches.length,
          lastBreachAt: anyOff ? null : lastBreachAt,
          heldByRecentBreach: anyOff ? false : !latest.alarm && breaches.length > 0,
          hotter: latest.delta === 0 ? null : latest.delta > 0 ? 'A' : 'B',
          ...trendInfo,
          ...recentMean(pairs, 6),
        };
      } catch (err) {
        return {
          ...base,
          pointA: { positionId: pin.pointA, name: infoA?.positionName ?? `Ponto ${pin.pointA}`, temp: null, t: null },
          pointB: { positionId: pin.pointB, name: infoB?.positionName ?? `Ponto ${pin.pointB}`, temp: null, t: null },
          offMachineA: false,
          offMachineB: false,
          peakAccA: null,
          peakAccB: null,
          mountedMinAccG: pin.mountedMinAccG ?? config.mountedMinAccG,
          mountedIsCustom: pin.mountedMinAccG != null,
          deviationMode,
          deviationReference,
          delta: null,
          t: null,
          lagMs: null,
          status: 'SEM_DADOS',
          inverted: false,
          breachCount: 0,
          lastBreachAt: null,
          heldByRecentBreach: false,
          hotter: null,
          reason: `Failed to read the series: ${(err as Error).message}`,
        };
      }
    }),
  );

  // O que precisa de ação sobe ao topo: alarme primeiro, e a inversão pesa
  // junto — um lado que trocou de lugar merece atenção mesmo sem romper o limite.
  const rank = { ALARME: 0, ALERTA: 1, SENSOR_FORA: 2, NORMAL: 3, SEM_DADOS: 4 } as const;
  const score = (s: PairState) => rank[s.status] - (s.inverted ? 0.5 : 0);
  states.sort((x, y) => {
    if (score(x) !== score(y)) return score(x) - score(y);
    return Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0);
  });

  return {
    pairs: states,
    settings: {
      thresholdC: defaultThresholdC,
      toleranceMs,
      riskHoldHours: RISK_HOLD_HOURS,
      mountedMinAccG: config.mountedMinAccG,
      offMachineMinTempGapC: config.offMachineMinTempGapC,
      temperatureOffsetC: config.temperatureOffsetC,
    },
    generatedAt: Date.now(),
  };
}
