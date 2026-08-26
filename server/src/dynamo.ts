import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config.js';
import type { TempSample, VibrationSample } from './types.js';

const client = new DynamoDBClient({
  region: config.aws.region,
  ...(config.aws.endpoint ? { endpoint: config.aws.endpoint } : {}),
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
});

const doc = DynamoDBDocumentClient.from(client);

/**
 * Série histórica de temperatura de um ponto.
 *
 * Layout da tabela de gráficos: `pk = "{positionId}-{chartType}"` e `sk` = epoch
 * em ms. O tipo 1 é a série de temperatura, gravada no atributo `T`.
 */
const TEMPERATURE_CHART_TYPE = 1;

export async function getTemperatureSeries(
  positionId: number,
  sinceMs: number,
  untilMs: number = Date.now(),
): Promise<TempSample[]> {
  const out: TempSample[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: config.aws.chartsTable,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `${positionId}-${TEMPERATURE_CHART_TYPE}`,
          ':from': sinceMs,
          ':to': untilMs,
        },
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      const raw = Number(item.T);
      // Correção aplicada já na leitura: nada abaixo daqui vê o valor bruto.
      if (Number.isFinite(raw)) {
        out.push({ t: Number(item.sk), v: raw - config.temperatureOffsetC });
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return out.sort((x, y) => x.t - y.t);
}

/**
 * Série de vibração de um ponto: aceleração RMS (g) e velocidade RMS (mm/s),
 * nos três eixos.
 *
 * Fica numa tabela diferente da temperatura, indexada pelo `activatorId` da
 * placa e com cadência horária — não pelo positionId como as séries de gráfico.
 */
const VIBRATION_TABLE = 'retina-daily-summary-boards';

export async function getVibrationSeries(
  boardId: string,
  sinceMs: number,
  untilMs: number = Date.now(),
): Promise<VibrationSample[]> {
  const out: VibrationSample[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: VIBRATION_TABLE,
        KeyConditionExpression: 'boardId = :b AND #d BETWEEN :from AND :to',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':b': boardId, ':from': sinceMs, ':to': untilMs },
        ProjectionExpression:
          '#d, accelerationRmsX, accelerationRmsY, accelerationRmsZ,' +
          ' velocityRmsX, velocityRmsY, velocityRmsZ',
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
      const sample: VibrationSample = {
        t: Number(item.date),
        accX: n(item.accelerationRmsX),
        accY: n(item.accelerationRmsY),
        accZ: n(item.accelerationRmsZ),
        velX: n(item.velocityRmsX),
        velY: n(item.velocityRmsY),
        velZ: n(item.velocityRmsZ),
      };
      // Registro sem nenhuma leitura de vibração não serve para o gráfico.
      const hasAny = [sample.accX, sample.accY, sample.accZ,
                      sample.velX, sample.velY, sample.velZ].some((v) => v != null);
      if (hasAny) out.push(sample);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return out.sort((a, b) => a.t - b.t);
}
