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
            f.id                       AS "facilityId",
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
      facilityId: r.facilityId,
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

/** Quantas ocorrências estão abertas em cada ativo, e a mais severa delas. */
export interface OpenOccurrenceSummary {
  assetId: number;
  openCount: number;
  /** maior sysStatusId entre as abertas — a mais severa */
  worstStatusId: number | null;
  worstStatus: string | null;
  /** abertura mais antiga ainda em aberto */
  oldestOpenedAt: string | null;
}

export async function getOpenOccurrences(
  assetIds: number[],
): Promise<Map<number, OpenOccurrenceSummary>> {
  const map = new Map<number, OpenOccurrenceSummary>();
  if (assetIds.length === 0) return map;

  const { rows } = await pool.query(
    `SELECT o."assetId",
            count(*)::int                AS "openCount",
            max(o."sysStatusId")         AS "worstStatusId",
            min(o."createdAt")           AS "oldestOpenedAt"
       FROM "tbAssetOccurrence" o
      WHERE o."assetId" = ANY($1::int[])
        AND o."deletedAt" IS NULL
        AND o."closedAt" IS NULL
        AND coalesce(o."sysStatusId", 0) <> $2
      GROUP BY o."assetId"`,
    [assetIds, COPILOT_STATUS_ID],
  );

  const statusNames = await statusMap();
  for (const r of rows) {
    map.set(r.assetId, {
      assetId: r.assetId,
      openCount: r.openCount,
      worstStatusId: r.worstStatusId,
      worstStatus: r.worstStatusId != null ? statusNames.get(r.worstStatusId) ?? null : null,
      oldestOpenedAt: r.oldestOpenedAt?.toISOString() ?? null,
    });
  }
  return map;
}

/**
 * A interface é inglesa, mas `tbSysStatus` guarda o rótulo só em português.
 * O conjunto é fixo (8 valores), então a tradução vive aqui.
 */
/**
 * Ocorrências geradas pela análise do Copilot não entram no painel: são
 * triagem automática, não ocorrência de manutenção.
 */
const COPILOT_STATUS_ID = 8;

const STATUS_EN: Record<number, string> = {
  1: 'Normal',
  2: 'Observation',
  3: 'Confirmed alert',
  4: 'Risk under analysis',
  5: 'Confirmed risk',
  6: 'Critical under analysis',
  7: 'Critical',
  8: 'Copilot analysis',
};

let statusCache: Map<number, string> | null = null;
async function statusMap(): Promise<Map<number, string>> {
  if (statusCache) return statusCache;
  const { rows } = await pool.query(`SELECT id, name FROM "tbSysStatus"`);
  statusCache = new Map(
    rows.map((r) => [r.id as number, STATUS_EN[r.id as number] ?? (r.name as string)]),
  );
  return statusCache;
}

export interface OccurrenceDiagnostic {
  id: number;
  label: string | null;
  diagnostic: string | null;
  recommendation: string | null;
  rootCause: string | null;
  /** o comentário que o analista escreve ao diagnosticar ou encerrar */
  comments: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByAI: boolean;
  closedAt: string | null;
  closedBy: string | null;
}

export interface OccurrenceRecord {
  id: number;
  assetId: number;
  assetName: string | null;
  status: string | null;
  statusId: number | null;
  openedAt: string;
  /** null quando a ocorrência foi aberta automaticamente pelo sistema */
  openedBy: string | null;
  manuallyOpened: boolean;
  closedAt: string | null;
  closedBy: string | null;
  validAnalysis: boolean | null;
  validDiagnostic: boolean | null;
  hadIntervention: boolean | null;
  /** o comentário escrito por quem fecha a ocorrência */
  closingComment: string | null;
  /** comentário avulso na própria ocorrência, quando existe */
  comments: string | null;
  diagnostics: OccurrenceDiagnostic[];
}

export interface OccurrenceHistory {
  occurrences: OccurrenceRecord[];
  /** quantas existem ao todo — o painel mostra só as mais recentes */
  total: number;
}

/**
 * Histórico de ocorrências de um ativo, com os diagnósticos de cada uma —
 * é o que alimenta a linha do tempo da tela de análise.
 *
 * Devolve também o total, para a tela poder dizer que está truncando em vez
 * de dar a impressão de que o ativo só teve essas.
 */
export async function getOccurrenceHistory(
  assetId: number,
  limit = 5,
): Promise<OccurrenceHistory> {
  const { rows } = await pool.query(
    `SELECT o.id, o."assetId", a.name AS "assetName",
            o."sysStatusId" AS "statusId",
            o."createdAt" AS "openedAt", uc.name AS "openedBy",
            coalesce(o."manuallyOpened", false) AS "manuallyOpened",
            o."closedAt", uf.name AS "closedBy",
            o."validAnalysis", o."validDiagnostic", o."hadIntervention",
            nullif(o."exclusionReason", '') AS "exclusionReason",
            nullif(o.comments, '') AS comments
       FROM "tbAssetOccurrence" o
       LEFT JOIN "tbAsset"     a  ON a.id  = o."assetId"
       LEFT JOIN "tbUser"      uc ON uc.id = o."createdBy"
       LEFT JOIN "tbUser"      uf ON uf.id = o."closedBy"
      WHERE o."assetId" = $1
        AND o."deletedAt" IS NULL
        AND coalesce(o."sysStatusId", 0) <> $3
      ORDER BY o."createdAt" DESC
      LIMIT $2`,
    [assetId, limit, COPILOT_STATUS_ID],
  );
  const { rows: counted } = await pool.query(
    `SELECT count(*)::int AS total
       FROM "tbAssetOccurrence" o
      WHERE o."assetId" = $1
        AND o."deletedAt" IS NULL
        AND coalesce(o."sysStatusId", 0) <> $2`,
    [assetId, COPILOT_STATUS_ID],
  );
  const total = counted[0]?.total ?? 0;

  if (rows.length === 0) return { occurrences: [], total };
  const statusNames = await statusMap();

  const ids = rows.map((r) => r.id);
  const { rows: diags } = await pool.query(
    `SELECT d.id, d."assetOccurrenceId",
            coalesce(nullif(dg."nameInEN", ''), dg.name) AS label,
            nullif(d.diagnostic, '')     AS diagnostic,
            nullif(d.recommendation, '') AS recommendation,
            nullif(d."rootCause", '')    AS "rootCause",
            nullif(d.comments, '')       AS comments,
            d."createdAt", ud.name AS "createdBy",
            coalesce(d."createdByAI", false) AS "createdByAI",
            d."closedAt", uf.name AS "closedBy"
       FROM "tbAssetOccurrenceDiagnostic" d
       LEFT JOIN "tbDiagnostic" dg ON dg.id = d."diagnosticId"
       LEFT JOIN "tbUser"       ud ON ud.id = d."createdBy"
       LEFT JOIN "tbUser"       uf ON uf.id = d."closedBy"
      WHERE d."assetOccurrenceId" = ANY($1::int[])
        AND d."deletedAt" IS NULL
      ORDER BY d."createdAt"`,
    [ids],
  );

  const byOccurrence = new Map<number, OccurrenceDiagnostic[]>();
  for (const d of diags) {
    const list = byOccurrence.get(d.assetOccurrenceId) ?? [];
    list.push({
      id: d.id,
      label: d.label,
      diagnostic: d.diagnostic,
      recommendation: d.recommendation,
      rootCause: d.rootCause,
      comments: d.comments,
      createdAt: d.createdAt.toISOString(),
      createdBy: d.createdBy,
      createdByAI: d.createdByAI,
      closedAt: d.closedAt?.toISOString() ?? null,
      closedBy: d.closedBy,
    });
    byOccurrence.set(d.assetOccurrenceId, list);
  }

  const occurrences = rows.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    assetName: r.assetName,
    status: r.statusId != null ? statusNames.get(r.statusId) ?? null : null,
    statusId: r.statusId,
    openedAt: r.openedAt.toISOString(),
    openedBy: r.openedBy,
    manuallyOpened: r.manuallyOpened,
    closedAt: r.closedAt?.toISOString() ?? null,
    closedBy: r.closedBy,
    validAnalysis: r.validAnalysis,
    validDiagnostic: r.validDiagnostic,
    hadIntervention: r.hadIntervention,
    closingComment: r.exclusionReason,
    comments: r.comments,
    diagnostics: byOccurrence.get(r.id) ?? [],
  }));

  return { occurrences, total };
}

export async function closePool() {
  await pool.end();
}
