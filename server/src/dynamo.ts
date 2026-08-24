import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config.js';
import type { TempSample } from './types.js';

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
