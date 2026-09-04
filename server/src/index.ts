import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import {
  getPositions,
  listPositionsByCompany,
  getCompanyTree,
  listCompanies,
  getOccurrenceHistory,
  listLines,
  getLinePoints,
  closePool,
} from './postgres.js';
import type { LinePoint } from './postgres.js';
import {
  listPairs, addPair, removePair, updatePairSettings, updatePairBaseline,
} from './pairsStore.js';
import { evaluateBoard, learnBaseline, dropStopped } from './board.js';
import { getTemperatureSeries, getVibrationSeries } from './dynamo.js';
import { pairSeries, diagnose, summarize } from './pairing.js';
import type { AnalysisResult, PositionInfo } from './types.js';

const app = express();
app.use(cors());
app.use(express.json());

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function placeholder(id: number): PositionInfo {
  return {
    positionId: id,
    positionName: `Ponto ${id}`,
    activatorId: null,
    assetId: null,
    assetName: null,
    facilityId: null,
    facilityName: null,
    companyId: null,
    companyName: null,
    lastAcquisitionDate: null,
  };
}

/**
 * Compara a temperatura de dois pontos ao longo do tempo e aponta os instantes
 * em que o desvio entre eles rompe o limite de falha de lubrificação.
 */
app.get('/api/analysis', async (req, res) => {
  try {
    const a = num(req.query.a, config.defaults.pointA);
    const b = num(req.query.b, config.defaults.pointB);
    const days = Math.min(num(req.query.days, config.defaults.days), 90);
    const toleranceMin = num(req.query.toleranceMin, config.defaults.toleranceMin);
    const toleranceMs = toleranceMin * 60_000;

    // O limite não vem por query string. Se este par estiver cravado, vale o
    // limite do ativo; senão, o padrão global do servidor.
    const pinned = await listPairs();
    const match = pinned.find(
      (p) => (p.pointA === a && p.pointB === b) || (p.pointA === b && p.pointB === a),
    );
    const thresholdC = match?.thresholdC ?? config.defaults.thresholdC;
    const mountedMinAccG = match?.mountedMinAccG ?? config.mountedMinAccG;
    const deviationMode = match?.deviationMode ?? 'ABSOLUTE';
    const deviationReference = deviationMode === 'RELATIVE' ? (match?.baselineC ?? 0) : 0;

    const since = Date.now() - days * 86_400_000;

    const [positions, seriesA, seriesB] = await Promise.all([
      getPositions([a, b]),
      getTemperatureSeries(a, since),
      getTemperatureSeries(b, since),
    ]);

    // A vibração é indexada pelo activatorId da placa, que só sai do Postgres,
    // por isso vem depois da consulta de metadados.
    const infoA = positions.get(a);
    const infoB = positions.get(b);
    const [vibrationA, vibrationB] = await Promise.all([
      infoA?.activatorId ? getVibrationSeries(infoA.activatorId, since) : [],
      infoB?.activatorId ? getVibrationSeries(infoB.activatorId, since) : [],
    ]);

    const paired = pairSeries(
      seriesA, seriesB, toleranceMs, thresholdC, deviationReference,
    );
    const discarded = paired.discarded;
    // Máquina parada esfria os mancais: a comparação não fala de lubrificação.
    const { running: pairs, stopped } = dropStopped(
      paired.pairs, vibrationA, vibrationB, config.runningMinAccG,
    );

    const result: AnalysisResult = {
      pointA: infoA ?? placeholder(a),
      pointB: infoB ?? placeholder(b),
      seriesA,
      seriesB,
      vibrationA,
      vibrationB,
      pairs,
      discarded,
      diagnostics: diagnose(seriesA, seriesB, pairs, discarded, stopped),
      settings: {
        thresholdC,
        toleranceMs,
        days,
        temperatureOffsetC: config.temperatureOffsetC,
        mountedMinAccG,
        mountedIsCustom: match?.mountedMinAccG != null,
        offMachineMinTempGapC: config.offMachineMinTempGapC,
        deviationMode,
        deviationReference,
        baselineC: match?.baselineC ?? null,
      },
      summary: summarize(pairs, thresholdC),
    };

    res.json(result);
  } catch (err) {
    console.error('[/api/analysis]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Pontos disponíveis de uma empresa, para trocar o par comparado. */
app.get('/api/positions', async (req, res) => {
  try {
    const companyId = num(req.query.companyId, 5);
    res.json(await listPositionsByCompany(companyId));
  } catch (err) {
    console.error('[/api/positions]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Unidade → ativo → pontos, para o seletor. */
app.get('/api/tree', async (req, res) => {
  try {
    const companyId = num(req.query.companyId, 5);
    res.json(await getCompanyTree(companyId));
  } catch (err) {
    console.error('[/api/tree]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/companies', async (_req, res) => {
  try {
    res.json(await listCompanies());
  } catch (err) {
    console.error('[/api/companies]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Pares cravados. */
app.get('/api/pairs', async (_req, res) => {
  try {
    res.json(await listPairs());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/pairs', async (req, res) => {
  try {
    const { companyId, facilityName, assetId, assetName, pointA, pointB, label, thresholdC } =
      req.body ?? {};
    if (!Number.isFinite(pointA) || !Number.isFinite(pointB)) {
      return res.status(400).json({ error: 'pointA e pointB são obrigatórios' });
    }
    if (pointA === pointB) {
      return res.status(400).json({ error: 'os dois pontos precisam ser diferentes' });
    }
    res.json(
      await addPair({
        companyId: Number(companyId) || 5,
        facilityName: facilityName ?? null,
        assetId: Number(assetId) || 0,
        assetName: assetName ?? null,
        pointA: Number(pointA),
        pointB: Number(pointB),
        label,
        thresholdC: Number.isFinite(thresholdC) ? Number(thresholdC) : undefined,
      }),
    );
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Ajusta os limites de um ativo já cravado: desvio tolerável e aceleração
 * mínima para o sensor contar como montado. Campo ausente fica como está;
 * campo vazio ou null volta ao padrão global.
 */
app.patch('/api/pairs/:id', async (req, res) => {
  try {
    const patch: {
      thresholdC?: number | null;
      mountedMinAccG?: number | null;
      deviationMode?: 'ABSOLUTE' | 'RELATIVE' | null;
    } = {};

    const parse = (raw: unknown, campo: string): number | null => {
      if (raw == null || raw === '') return null;
      const v = Number(raw);
      if (!Number.isFinite(v) || v <= 0) {
        throw new Error(`${campo} precisa ser um número maior que zero`);
      }
      return v;
    };

    if ('thresholdC' in (req.body ?? {})) {
      patch.thresholdC = parse(req.body.thresholdC, 'thresholdC');
    }
    if ('mountedMinAccG' in (req.body ?? {})) {
      patch.mountedMinAccG = parse(req.body.mountedMinAccG, 'mountedMinAccG');
    }
    if ('deviationMode' in (req.body ?? {})) {
      const mode = req.body.deviationMode;
      if (mode != null && mode !== 'ABSOLUTE' && mode !== 'RELATIVE') {
        throw new Error('deviationMode precisa ser ABSOLUTE ou RELATIVE');
      }
      patch.deviationMode = mode ?? null;
    }

    const pair = await updatePairSettings(req.params.id, patch);
    res.status(pair ? 200 : 404).json(pair ?? { error: 'par não encontrado' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Aprende o desvio normal de um ativo a partir de uma janela sadia escolhida
 * pelo usuário, ou grava/limpa o valor na mão.
 */
app.post('/api/pairs/:id/baseline', async (req, res) => {
  try {
    const pinned = await listPairs();
    const pair = pinned.find((p) => p.id === req.params.id);
    if (!pair) return res.status(404).json({ error: 'par não encontrado' });

    const { from, to, baselineC } = req.body ?? {};

    // Limpar
    if (from == null && to == null && baselineC == null) {
      return res.json({ pair: await updatePairBaseline(pair.id, null), samples: 0 });
    }

    // Valor informado na mão
    if (baselineC != null) {
      const value = Number(baselineC);
      if (!Number.isFinite(value)) {
        return res.status(400).json({ error: 'baselineC precisa ser um número' });
      }
      return res.json({ pair: await updatePairBaseline(pair.id, { baselineC: value }), samples: 0 });
    }

    // Aprendido da janela
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      return res.status(400).json({ error: 'janela inválida' });
    }

    const toleranceMin = num(req.query.toleranceMin, config.defaults.toleranceMin);
    const learned = await learnBaseline(
      pair.pointA, pair.pointB, fromMs, toMs, toleranceMin * 60_000,
    );
    if (!learned) {
      return res.status(422).json({
        error: 'nenhuma comparação simultânea nessa janela — escolha outro período',
      });
    }

    const updated = await updatePairBaseline(pair.id, {
      baselineC: Number(learned.baselineC.toFixed(2)),
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    });
    res.json({ pair: updated, samples: learned.samples });
  } catch (err) {
    console.error('[/api/pairs/:id/baseline]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/pairs/:id', async (req, res) => {
  try {
    const ok = await removePair(req.params.id);
    res.status(ok ? 200 : 404).json({ ok });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Estado atual de todos os pares cravados. */
app.get('/api/board', async (req, res) => {
  try {
    // O limite e cravado no servidor: nao ha override por query string.
    const thresholdC = config.defaults.thresholdC;
    const toleranceMin = num(req.query.toleranceMin, config.defaults.toleranceMin);
    const pinned = await listPairs();
    res.json(await evaluateBoard(pinned, thresholdC, toleranceMin * 60_000));
  } catch (err) {
    console.error('[/api/board]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Linha do tempo de ocorrências de um ativo. */
app.get('/api/occurrences', async (req, res) => {
  try {
    const assetId = num(req.query.assetId, 0);
    if (!assetId) return res.status(400).json({ error: 'assetId é obrigatório' });
    res.json(await getOccurrenceHistory(assetId, Math.min(num(req.query.limit, 5), 50)));
  } catch (err) {
    console.error('[/api/occurrences]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Linhas de produção da empresa (SC1, SC2, RS7…). */
app.get('/api/lines', async (req, res) => {
  try {
    res.json(await listLines(num(req.query.companyId, 5)));
  } catch (err) {
    console.error('[/api/lines]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Os rolos de uma linha, dentro de uma unidade, com a temperatura atual —
 * para comparar o mesmo lado entre rolos diferentes.
 *
 * A unidade é obrigatória: o prefixo da linha vive no nome do ativo e nada
 * impede duas plantas de usarem "SC1" para linhas diferentes.
 */
app.get('/api/line', async (req, res) => {
  try {
    const line = String(req.query.line ?? '').trim();
    if (!/^[A-Z]{2}[0-9]+$/.test(line)) {
      return res.status(400).json({ error: 'line inválida' });
    }
    const facilityId = num(req.query.facilityId, 0);
    if (!facilityId) return res.status(400).json({ error: 'facilityId obrigatório' });

    const points = await getLinePoints(num(req.query.companyId, 5), facilityId, line);
    const pinned = await listPairs();
    const pinnedAssets = new Set(pinned.map((p) => p.assetId));

    res.json({
      line,
      facilityId,
      points: points.map((p: LinePoint) => ({ ...p, pinned: pinnedAssets.has(p.assetId) })),
    });
  } catch (err) {
    console.error('[/api/line]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const server = app.listen(config.port, () => {
  console.log(`API em http://localhost:${config.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => closePool().finally(() => process.exit(0)));
  });
}
