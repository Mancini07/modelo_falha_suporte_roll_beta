import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// O .env fica na raiz do projeto, um nível acima de server/.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  pg: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME'),
  },
  aws: {
    region: process.env.AWS_REGION ?? 'us-east-1',
    accessKeyId: required('AWS_ACCESS_KEY_ID'),
    secretAccessKey: required('AWS_SECRET_ACCESS_KEY'),
    /** vazio = endpoint padrão da AWS */
    endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
    chartsTable: process.env.DYNAMODB_TABLE_EVENTS ?? 'retina-global-charts',
  },
  /**
   * Correção aplicada a toda leitura de temperatura, em °C. O valor bruto do
   * sensor lê alto; este offset é subtraído na entrada, então todo o resto do
   * sistema já trabalha com a temperatura corrigida.
   */
  temperatureOffsetC: Number(process.env.TEMPERATURE_OFFSET_C ?? 6.8),

  /**
   * Aceleração RMS mínima, em g, para considerar que o sensor está montado na
   * máquina. Abaixo disso — com o par do mesmo ativo acima — o sensor está
   * solto, e a temperatura que ele lê é do ambiente, não do mancal.
   */
  mountedMinAccG: Number(process.env.MOUNTED_MIN_ACC_G ?? 0.03),

  /**
   * Quanto o sensor suspeito precisa estar MAIS FRIO que o par, em °C, para
   * confirmar que está fora da máquina. Vibração baixa sozinha não basta: um
   * sensor solto lê o ambiente, então precisa estar visivelmente mais frio que
   * o mancal do outro lado. Sem essa segunda evidência, a suspeita não é
   * declarada e o ativo segue sendo avaliado por lubrificação.
   */
  offMachineMinTempGapC: Number(process.env.OFF_MACHINE_MIN_TEMP_GAP_C ?? 10),

  /** padrões do domínio, sobrescrevíveis por query string */
  defaults: {
    thresholdC: 3,
    // Defasagem real entre sensores do mesmo ativo vai de ~6 a ~8 min,
    // conforme o slot que cada um ocupa no gateway.
    toleranceMin: 10,
    days: 7,
    pointA: 21547,
    pointB: 21548,
  },
} as const;
