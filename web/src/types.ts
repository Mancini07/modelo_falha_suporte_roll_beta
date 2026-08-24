export interface PointState {
  positionId: number;
  name: string;
  temp: number | null;
  /** instante exato em que esta leitura foi registrada */
  t: number | null;
}

export interface PairState {
  id: string;
  assetId: number;
  assetName: string | null;
  facilityName: string | null;
  companyName: string | null;
  label?: string;
  pointA: PointState;
  pointB: PointState;
  delta: number | null;
  t: number | null;
  lagMs: number | null;
  status: 'ALARME' | 'NORMAL' | 'SEM_DADOS';
  /** limite aplicado a este par (o do ativo, ou o padrão global) */
  thresholdC: number;
  /** true quando o limite veio do ativo, não do padrão */
  thresholdIsCustom: boolean;
  /** desvio normal do ativo, com sinal; null quando ainda não foi aprendido */
  baselineC: number | null;
  /** o lado quente trocou em relação ao normal do ativo */
  inverted: boolean;
  /** quantas comparações romperam o limite na janela de risco */
  breachCount: number;
  /** instante do rompimento mais recente na janela */
  lastBreachAt: number | null;
  /** dentro do limite agora, mas ainda em risco por rompimento recente */
  heldByRecentBreach: boolean;
  hotter: 'A' | 'B' | null;
  reason?: string;
}

export interface BoardResult {
  pairs: PairState[];
  settings: {
    thresholdC: number;
    toleranceMs: number;
    temperatureOffsetC: number;
    riskHoldHours: number;
  };
  generatedAt: number;
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

export interface PinnedPair {
  id: string;
  companyId: number;
  facilityName: string | null;
  assetId: number;
  assetName: string | null;
  pointA: number;
  pointB: number;
  label?: string;
  thresholdC?: number;
  baselineC?: number;
  baselineFrom?: string;
  baselineTo?: string;
  createdAt: string;
}

export interface Company {
  companyId: number;
  companyName: string;
  pontos: number;
}

/* --- Analytics screen ---------------------------------------------------- */

export interface TempSample { t: number; v: number }

export interface PositionInfo {
  positionId: number;
  positionName: string;
  activatorId: string | null;
  assetId: number | null;
  assetName: string | null;
  facilityName: string | null;
  companyId: number | null;
  companyName: string | null;
  lastAcquisitionDate: string | null;
}

export interface ComparedPair {
  t: number;
  tA: number;
  tB: number;
  a: number;
  b: number;
  lagMs: number;
  delta: number;
  alarm: boolean;
}

export interface DiscardedSample {
  t: number;
  v: number;
  nearestLagMs: number | null;
}

export interface PairingDiagnostics {
  samplesA: number;
  samplesB: number;
  paired: number;
  discarded: number;
  minLagMs: number | null;
  medianLagMs: number | null;
  yieldByToleranceMin: Array<{ toleranceMin: number; pairs: number }>;
}

export interface AnalysisResult {
  pointA: PositionInfo;
  pointB: PositionInfo;
  seriesA: TempSample[];
  seriesB: TempSample[];
  pairs: ComparedPair[];
  discarded: DiscardedSample[];
  diagnostics: PairingDiagnostics;
  settings: {
    thresholdC: number;
    toleranceMs: number;
    days: number;
    temperatureOffsetC: number;
  };
  summary: {
    latest: ComparedPair | null;
    status: 'ALARME' | 'NORMAL' | 'SEM_DADOS';
    alarmCount: number;
    alarmRatio: number;
    maxAbsDelta: number | null;
    avgAbsDelta: number | null;
    alarmStreakMs: number | null;
  };
}

export interface AnalysisSettings {
  pointA: number;
  pointB: number;
  days: number;
  thresholdC: number;
  toleranceMin: number;
}
