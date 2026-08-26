import { config } from './config.js';
import { getTemperatureSeries, getVibrationSeries } from './dynamo.js';
import { getPositions, getOpenOccurrences } from './postgres.js';
import { pairSeries } from './pairing.js';
import type { PinnedPair } from './pairsStore.js';
import type { BoardResult, PairState, VibrationSample } from './types.js';

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

        const { pairs } = pairSeries(a, b, toleranceMs, thresholdC);
        const latest = pairs[pairs.length - 1];

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
              : 'NORMAL',
          inverted: anyOff ? false : isInverted(latest.delta, baselineC, thresholdC),
          breachCount: anyOff ? 0 : breaches.length,
          lastBreachAt: anyOff ? null : lastBreachAt,
          heldByRecentBreach: anyOff ? false : !latest.alarm && breaches.length > 0,
          hotter: latest.delta === 0 ? null : latest.delta > 0 ? 'A' : 'B',
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
  const rank = { ALARME: 0, SENSOR_FORA: 1, NORMAL: 2, SEM_DADOS: 3 } as const;
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
