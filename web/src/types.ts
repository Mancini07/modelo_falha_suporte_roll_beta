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
  status: 'ALARME' | 'NORMAL' | 'SEM_DADOS' | 'SENSOR_FORA';
  /** sensor solto da máquina — a temperatura dele não é a do mancal */
  offMachineA: boolean;
  offMachineB: boolean;
  /** menor aceleração RMS entre os eixos de cada ponto, em g */
  peakAccA: number | null;
  peakAccB: number | null;
  mountedMinAccG: number;
  mountedIsCustom: boolean;
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
  /** ocorrências abertas neste ativo — independe do estado dos sensores */
  openOccurrences: number;
  occurrenceStatus: string | null;
  occurrenceStatusId: number | null;
  occurrenceOpenedAt: string | null;
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

export interface OccurrenceHistory {
  occurrences: OccurrenceRecord[];
  /** quantas existem ao todo — a tela mostra só as mais recentes */
  total: number;
}

export interface OccurrenceRecord {
  id: number;
  assetId: number;
  assetName: string | null;
  status: string | null;
  statusId: number | null;
  openedAt: string;
  /** null quando aberta automaticamente pelo sistema */
  openedBy: string | null;
  manuallyOpened: boolean;
  closedAt: string | null;
  closedBy: string | null;
  validAnalysis: boolean | null;
  validDiagnostic: boolean | null;
  hadIntervention: boolean | null;
  /** o comentário escrito por quem fecha a ocorrência */
  closingComment: string | null;
  comments: string | null;
  diagnostics: OccurrenceDiagnostic[];
}

export interface BoardResult {
  pairs: PairState[];
  settings: {
    thresholdC: number;
    toleranceMs: number;
    temperatureOffsetC: number;
    riskHoldHours: number;
    mountedMinAccG: number;
    offMachineMinTempGapC: number;
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

/** Vibração num instante: aceleração RMS (g) e velocidade RMS (mm/s) por eixo. */
export interface VibrationSample {
  t: number;
  accX: number | null;
  accY: number | null;
  accZ: number | null;
  velX: number | null;
  velY: number | null;
  velZ: number | null;
}

export interface PositionInfo {
  positionId: number;
  positionName: string;
  activatorId: string | null;
  assetId: number | null;
  assetName: string | null;
  facilityId: number | null;
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
  vibrationA: VibrationSample[];
  vibrationB: VibrationSample[];
  pairs: ComparedPair[];
  discarded: DiscardedSample[];
  diagnostics: PairingDiagnostics;
  settings: {
    thresholdC: number;
    toleranceMs: number;
    days: number;
    temperatureOffsetC: number;
    mountedMinAccG: number;
    mountedIsCustom: boolean;
    offMachineMinTempGapC: number;
  };
  summary: {
    latest: ComparedPair | null;
    status: 'ALARME' | 'NORMAL' | 'SEM_DADOS' | 'SENSOR_FORA';
  /** sensor solto da máquina — a temperatura dele não é a do mancal */
  offMachineA: boolean;
  offMachineB: boolean;
  /** menor aceleração RMS entre os eixos de cada ponto, em g */
  peakAccA: number | null;
  peakAccB: number | null;
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
