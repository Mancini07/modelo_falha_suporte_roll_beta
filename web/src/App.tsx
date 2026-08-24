import { useCallback, useEffect, useState } from 'react';
import {
  fetchBoard, fetchTree, pinPair, setPairThreshold, learnBaseline, unpinPair,
} from './api';
import type { BoardResult, TreeAsset, TreeFacility } from './types';
import BoardView from './views/BoardView';
import AnalyticsView from './views/AnalyticsView';

const COMPANY_ID = 5;
const REFRESH_MS = 60_000;

type Screen = 'board' | 'analytics';

export default function App() {
  const [screen, setScreen] = useState<Screen>('board');
  const [analysePairId, setAnalysePairId] = useState<string | null>(null);

  const [toleranceMin, setToleranceMin] = useState(10);

  const [board, setBoard] = useState<BoardResult | null>(null);
  const [tree, setTree] = useState<TreeFacility[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setError(null);
        setBoard(await fetchBoard(toleranceMin, signal));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [toleranceMin],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setBusy(true);
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Atualização periódica: o painel fica aberto na parede da manutenção.
  useEffect(() => {
    if (screen !== 'board') return;
    const id = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load, screen]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchTree(COMPANY_ID, ctrl.signal).then(setTree).catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  /** O limite é definido no servidor e chega junto com o painel. */
  const thresholdC = board?.settings.thresholdC ?? 3;

  async function handlePin(input: {
    facilityName: string;
    asset: TreeAsset;
    pointA: number;
    pointB: number;
    thresholdC: number | null;
  }) {
    try {
      await pinPair({
        companyId: COMPANY_ID,
        facilityName: input.facilityName,
        assetId: input.asset.assetId,
        assetName: input.asset.assetName,
        pointA: input.pointA,
        pointB: input.pointB,
        thresholdC: input.thresholdC ?? undefined,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleUpdateThreshold(id: string, thresholdC: number | null) {
    try {
      await setPairThreshold(id, thresholdC);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleLearnBaseline(
    id: string,
    window: { from: string; to: string } | null,
  ) {
    try {
      await learnBaseline(id, window, toleranceMin);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleRemove(id: string) {
    try {
      await unpinPair(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="app">
      {screen === 'board' ? (
        <BoardView
          board={board}
          tree={tree}
          busy={busy}
          error={error}
          thresholdC={thresholdC}
          toleranceMin={toleranceMin}
          onTolerance={setToleranceMin}
          onPin={handlePin}
          onUpdateThreshold={handleUpdateThreshold}
          onLearnBaseline={handleLearnBaseline}
          onRemove={handleRemove}
          onAnalyse={(pairId) => {
            setAnalysePairId(pairId);
            setScreen('analytics');
          }}
        />
      ) : (
        <AnalyticsView
          pinned={board?.pairs ?? []}
          thresholdC={thresholdC}
          toleranceMin={toleranceMin}
          initialPairId={analysePairId}
          onBack={() => setScreen('board')}
        />
      )}
    </div>
  );
}
