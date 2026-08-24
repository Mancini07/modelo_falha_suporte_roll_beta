import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(here, '../data/pairs.json');

/** Um par cravado: o que o painel monitora de forma permanente. */
export interface PinnedPair {
  id: string;
  companyId: number;
  facilityName: string | null;
  assetId: number;
  assetName: string | null;
  pointA: number;
  pointB: number;
  /** rótulo opcional dado pelo usuário */
  label?: string;
  /**
   * Limite de desvio tolerável deste ativo, em °C. Cada máquina tem a sua
   * assimetria normal entre mancais; quando ausente, vale o padrão global.
   */
  thresholdC?: number;
  /**
   * Desvio normal deste ativo, COM SINAL — qual lado costuma ser o mais quente
   * e por quanto. Não desloca o alarme de módulo; serve de referência para
   * detectar quando os lados se invertem.
   */
  baselineC?: number;
  /** Janela de onde o baseline foi aprendido, para rastreabilidade. */
  baselineFrom?: string;
  baselineTo?: string;
  createdAt: string;
}

async function readAll(): Promise<PinnedPair[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8')) as PinnedPair[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(pairs: PinnedPair[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(pairs, null, 2), 'utf8');
}

export async function listPairs(): Promise<PinnedPair[]> {
  return readAll();
}

export async function addPair(
  input: Omit<PinnedPair, 'id' | 'createdAt'>,
): Promise<PinnedPair> {
  const pairs = await readAll();

  // O mesmo par (em qualquer ordem) não é cravado duas vezes.
  const dup = pairs.find(
    (p) =>
      (p.pointA === input.pointA && p.pointB === input.pointB) ||
      (p.pointA === input.pointB && p.pointB === input.pointA),
  );
  if (dup) return dup;

  const pair: PinnedPair = {
    ...input,
    id: `${input.pointA}-${input.pointB}`,
    createdAt: new Date().toISOString(),
  };
  pairs.push(pair);
  await writeAll(pairs);
  return pair;
}

/** Ajusta o limite de um par já cravado. */
export async function updatePairThreshold(
  id: string,
  thresholdC: number | null,
): Promise<PinnedPair | null> {
  const pairs = await readAll();
  const pair = pairs.find((p) => p.id === id);
  if (!pair) return null;

  if (thresholdC == null) delete pair.thresholdC;
  else pair.thresholdC = thresholdC;

  await writeAll(pairs);
  return pair;
}

/** Grava (ou limpa, com `null`) o desvio normal de um par. */
export async function updatePairBaseline(
  id: string,
  baseline: { baselineC: number; from?: string; to?: string } | null,
): Promise<PinnedPair | null> {
  const pairs = await readAll();
  const pair = pairs.find((p) => p.id === id);
  if (!pair) return null;

  if (baseline == null) {
    delete pair.baselineC;
    delete pair.baselineFrom;
    delete pair.baselineTo;
  } else {
    pair.baselineC = baseline.baselineC;
    if (baseline.from) pair.baselineFrom = baseline.from;
    if (baseline.to) pair.baselineTo = baseline.to;
  }

  await writeAll(pairs);
  return pair;
}

export async function removePair(id: string): Promise<boolean> {
  const pairs = await readAll();
  const next = pairs.filter((p) => p.id !== id);
  if (next.length === pairs.length) return false;
  await writeAll(next);
  return true;
}

export async function reorderPairs(ids: string[]): Promise<PinnedPair[]> {
  const pairs = await readAll();
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const next = [
    ...ids.map((id) => byId.get(id)).filter((p): p is PinnedPair => p != null),
    ...pairs.filter((p) => !ids.includes(p.id)),
  ];
  await writeAll(next);
  return next;
}
