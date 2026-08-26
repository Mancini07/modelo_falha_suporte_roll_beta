import type { BoardResult, Company, TreeFacility } from './types';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? 'Falha na requisição');
  }
  return res.json();
}

/**
 * O limite de desvio nao e enviado pelo cliente: quem manda e o servidor
 * (config.defaults.thresholdC). Assim ele fica cravado de verdade, sem depender
 * de a interface esconder o campo.
 */
export function fetchBoard(toleranceMin: number, signal?: AbortSignal): Promise<BoardResult> {
  const qs = new URLSearchParams({ toleranceMin: String(toleranceMin) });
  return json<BoardResult>(`/api/board?${qs}`, { signal });
}

export function fetchTree(companyId: number, signal?: AbortSignal): Promise<TreeFacility[]> {
  return json<TreeFacility[]>(`/api/tree?companyId=${companyId}`, { signal });
}

export function fetchCompanies(signal?: AbortSignal): Promise<Company[]> {
  return json<Company[]>('/api/companies', { signal });
}

export interface NewPair {
  companyId: number;
  facilityName: string | null;
  assetId: number;
  assetName: string | null;
  pointA: number;
  pointB: number;
  /** limite tolerável deste ativo; ausente = padrão global */
  thresholdC?: number;
}

export function pinPair(pair: NewPair) {
  return json(`/api/pairs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pair),
  });
}

/**
 * Ajusta os limites de um ativo já cravado. Campo omitido fica como está;
 * `null` volta ao padrão global.
 */
export function setPairSettings(
  id: string,
  patch: { thresholdC?: number | null; mountedMinAccG?: number | null },
) {
  return json(`/api/pairs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export const setPairThreshold = (id: string, thresholdC: number | null) =>
  setPairSettings(id, { thresholdC });

export interface BaselineResult {
  pair: { baselineC?: number; baselineFrom?: string; baselineTo?: string };
  samples: number;
}

/** Aprende o desvio normal de um ativo numa janela, ou limpa com `null`. */
export function learnBaseline(
  id: string,
  window: { from: string; to: string } | null,
  toleranceMin: number,
) {
  return json<BaselineResult>(
    `/api/pairs/${encodeURIComponent(id)}/baseline?toleranceMin=${toleranceMin}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(window ?? {}),
    },
  );
}

export function unpinPair(id: string) {
  return json(`/api/pairs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function fetchAnalysis(
  s: import('./types').AnalysisSettings,
  signal?: AbortSignal,
): Promise<import('./types').AnalysisResult> {
  // Sem `threshold`: o limite vem cravado do servidor.
  const qs = new URLSearchParams({
    a: String(s.pointA),
    b: String(s.pointB),
    days: String(s.days),
    toleranceMin: String(s.toleranceMin),
  });
  return json(`/api/analysis?${qs}`, { signal });
}
