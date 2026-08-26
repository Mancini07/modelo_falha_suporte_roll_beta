import pg from 'pg';
import { config } from './config.js';
import type { PositionInfo } from './types.js';

const pool = new pg.Pool({
  ...config.pg,
  ssl: { rejectUnauthorized: false },
  max: 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
  // Mantém a conexão ociosa viva: sem isso o RDS derruba o socket depois de
  // alguns minutos parado, que é justamente o caso do painel fora de uso.
  keepAlive: true,
});

/**
 * O pool emite 'error' quando um cliente OCIOSO perde a conexão — RDS
 * encerrando socket parado, failover, queda de rede. Sem um ouvinte aqui, o
 * Node trata como exceção não capturada e derruba o processo inteiro: a API
 * morria sozinha depois de um tempo sem uso.
 *
 * Registrando o ouvinte, o cliente quebrado é descartado e o pool abre outro
 * na próxima consulta.
 */
pool.on('error', (err) => {
  console.error('[postgres] cliente ocioso caiu, será descartado:', err.message);
});

/**
 * Metadados dos pontos: nome, ativo, unidade e empresa.
 * A empresa vem pela cadeia posição -> ativo -> unidade -> empresa.
 */
export async function getPositions(ids: number[]): Promise<Map<number, PositionInfo>> {
  const { rows } = await pool.query(
    `SELECT p.id                       AS "positionId",
            p.name                     AS "positionName",
            p."activatorId",
            p."assetId",
            p."lastAcquisitionDate",
            a.name                     AS "assetName",
            f.name                     AS "facilityName",
            co.id                      AS "companyId",
            co.name                    AS "companyName"
       FROM "tbPosition" p
       LEFT JOIN "tbAsset"    a  ON a.id = p."assetId"
       LEFT JOIN "tbFacility" f  ON f.id = a."facilityId"
       LEFT JOIN "tbCompany"  co ON co.id = f."companyId"
      WHERE p.id = ANY($1::int[])
        AND p."deletedAt" IS NULL`,
    [ids],
  );

  const map = new Map<number, PositionInfo>();
  for (const r of rows) {
    map.set(r.positionId, {
      positionId: r.positionId,
      positionName: r.positionName,
      activatorId: r.activatorId,
      assetId: r.assetId,
      assetName: r.assetName,
      facilityName: r.facilityName,
      companyId: r.companyId,
      companyName: r.companyName?.trim() ?? null,
      lastAcquisitionDate: r.lastAcquisitionDate?.toISOString() ?? null,
    });
  }
  return map;
}

/** Pontos com temperatura de uma empresa — alimenta os seletores do painel. */
export async function listPositionsByCompany(companyId: number) {
  const { rows } = await pool.query(
    `SELECT p.id                AS "positionId",
            p.name              AS "positionName",
            a.id                AS "assetId",
            a.name              AS "assetName",
            f.name              AS "facilityName",
            p."lastAcquisitionDate"
       FROM "tbPosition" p
       JOIN "tbAsset"    a ON a.id = p."assetId"
       JOIN "tbFacility" f ON f.id = a."facilityId"
      WHERE f."companyId" = $1
        AND p."deletedAt" IS NULL
        AND p."activatorId" IS NOT NULL
        AND p."lastAcquisitionDate" > now() - interval '30 days'
      ORDER BY a.name, p.name`,
    [companyId],
  );
  return rows;
}

export interface TreePosition {
  positionId: number;
  positionName: string;
  lastAcquisitionDate: string | null;
}

export interface TreeAsset {
  assetId: number;
  assetName: string;
  positions: TreePosition[];
}

export interface TreeFacility {
  facilityId: number;
  facilityName: string;
  assets: TreeAsset[];
}

/**
 * Unidade → ativo → pontos de uma empresa. Só ativos com pelo menos dois pontos
 * de temperatura, porque a comparação exige um par.
 */
export async function getCompanyTree(companyId: number): Promise<TreeFacility[]> {
  const { rows } = await pool.query(
    `SELECT f.id   AS "facilityId",
            f.name AS "facilityName",
            a.id   AS "assetId",
            a.name AS "assetName",
            p.id   AS "positionId",
            p.name AS "positionName",
            p."lastAcquisitionDate"
       FROM "tbFacility" f
       JOIN "tbAsset"    a ON a."facilityId" = f.id AND a."deletedAt" IS NULL
       JOIN "tbPosition" p ON p."assetId"    = a.id AND p."deletedAt" IS NULL
      WHERE f."companyId" = $1
        AND f."deletedAt" IS NULL
        AND p."sysSensorTypeId" = 1
        AND p."activatorId" IS NOT NULL
      ORDER BY f.name, a.name, p.name`,
    [companyId],
  );

  const facilities = new Map<number, TreeFacility>();
  const assets = new Map<number, TreeAsset>();

  for (const r of rows) {
    let facility = facilities.get(r.facilityId);
    if (!facility) {
      facility = { facilityId: r.facilityId, facilityName: r.facilityName?.trim(), assets: [] };
      facilities.set(r.facilityId, facility);
    }

    let asset = assets.get(r.assetId);
    if (!asset) {
      asset = { assetId: r.assetId, assetName: r.assetName, positions: [] };
      assets.set(r.assetId, asset);
      facility.assets.push(asset);
    }

    asset.positions.push({
      positionId: r.positionId,
      positionName: r.positionName,
      lastAcquisitionDate: r.lastAcquisitionDate?.toISOString() ?? null,
    });
  }

  // Um ativo com um ponto só não tem par para comparar.
  for (const f of facilities.values()) {
    f.assets = f.assets.filter((a) => a.positions.length >= 2);
  }
  return [...facilities.values()].filter((f) => f.assets.length > 0);
}

/** Empresas que têm pontos de temperatura ativos. */
export async function listCompanies() {
  const { rows } = await pool.query(
    `SELECT co.id AS "companyId", co.name AS "companyName",
            count(DISTINCT p.id)::int AS pontos
       FROM "tbCompany"  co
       JOIN "tbFacility" f  ON f."companyId" = co.id AND f."deletedAt" IS NULL
       JOIN "tbAsset"    a  ON a."facilityId" = f.id AND a."deletedAt" IS NULL
       JOIN "tbPosition" p  ON p."assetId" = a.id AND p."deletedAt" IS NULL
      WHERE co."deletedAt" IS NULL
        AND p."sysSensorTypeId" = 1
        AND p."activatorId" IS NOT NULL
        AND p."lastAcquisitionDate" > now() - interval '7 days'
      GROUP BY 1, 2
     HAVING count(DISTINCT p.id) >= 2
      ORDER BY 2`,
  );
  return rows.map((r) => ({ ...r, companyName: r.companyName?.trim() }));
}

export async function closePool() {
  await pool.end();
}
