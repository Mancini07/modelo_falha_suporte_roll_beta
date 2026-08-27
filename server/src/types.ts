/** Uma leitura de temperatura vinda do histórico de gráficos. */
export interface TempSample {
  /** epoch em milissegundos */
  t: number;
  /** temperatura em °C */
  v: number;
}

/**
 * Vibração de um ponto num instante: aceleração RMS em g e velocidade RMS em
 * mm/s, nos eixos Horizontal (X), Vertical (Y) e Axial (Z).
 */
export interface VibrationSample {
  t: number;
  accX: number | null;
  accY: number | null;
  accZ: number | null;
  velX: number | null;
  velY: number | null;
  velZ: number | null;
}

/** Identificação do ponto de medição (vem do Postgres). */
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

/**
 * Um par de leituras consideradas simultâneas: as duas amostras mais próximas
 * no tempo, desde que a defasagem esteja dentro da tolerância.
 */
export interface ComparedPair {
  /** instante de referência (timestamp da amostra do ponto A) */
  t: number;
  /** instante exato da leitura do ponto A */
  tA: number;
  /** instante exato da leitura do ponto B */
  tB: number;
  /** temperatura do ponto A */
  a: number;
  /** temperatura do ponto B */
  b: number;
  /** defasagem entre as duas leituras, em ms */
  lagMs: number;
  /** a - b, com sinal (positivo = A mais quente) */
  delta: number;
  /** |delta| acima do limite configurado */
  alarm: boolean;
}

/** Amostra de A que não encontrou par dentro da tolerância. */
export interface DiscardedSample {
  t: number;
  v: number;
  /** defasagem até a amostra mais próxima de B, em ms (null se B está vazio) */
  nearestLagMs: number | null;
}

export interface PairingDiagnostics {
  samplesA: number;
  samplesB: number;
  /** quantas amostras de A viraram par válido */
  paired: number;
  /** quantas amostras de A foram descartadas por defasagem */
  discarded: number;
  /** menor defasagem observada entre as duas séries, em ms */
  minLagMs: number | null;
  /** defasagem mediana entre pares mais próximos, em ms */
  medianLagMs: number | null;
  /** quantos pares existiriam para cada tolerância candidata (em minutos) */
  yieldByToleranceMin: Array<{ toleranceMin: number; pairs: number }>;
}

/** Estado atual de um par cravado — o que cada ativo mostra no painel. */
export interface PairState {
  id: string;
  assetId: number;
  assetName: string | null;
  facilityName: string | null;
  companyName: string | null;
  label?: string;

  pointA: { positionId: number; name: string; temp: number | null; t: number | null };
  pointB: { positionId: number; name: string; temp: number | null; t: number | null };

  /** a - b, com sinal. null quando não houve par simultâneo. */
  delta: number | null;
  /** instante da comparação */
  t: number | null;
  /** defasagem entre as duas leituras, em ms */
  lagMs: number | null;

  status: 'ALARME' | 'NORMAL' | 'SEM_DADOS' | 'SENSOR_FORA';
  /**
   * Sensor com aceleração abaixo do mínimo enquanto o par do mesmo ativo está
   * acima: indica sensor solto da máquina. Enquanto isso vale, a comparação de
   * temperatura não diz nada sobre lubrificação.
   */
  offMachineA: boolean;
  offMachineB: boolean;
  /** maior aceleração RMS de cada ponto, em g — a evidência da regra acima */
  peakAccA: number | null;
  peakAccB: number | null;
  /** aceleração mínima aplicada a este par (do ativo, ou o padrão global) */
  mountedMinAccG: number;
  /** true quando o mínimo veio do ativo, não do padrão */
  mountedIsCustom: boolean;
  /** limite aplicado a este par (o do ativo, ou o padrão global) */
  thresholdC: number;
  /** true quando o limite veio do ativo, não do padrão */
  thresholdIsCustom: boolean;
  /** desvio normal do ativo, com sinal; null quando ainda não foi aprendido */
  baselineC: number | null;
  /** quantas comparações romperam o limite na janela de risco */
  breachCount: number;
  /** instante do rompimento mais recente na janela */
  lastBreachAt: number | null;
  /**
   * true quando o desvio atual está dentro do limite, mas o ativo continua em
   * risco por ter rompido dentro da janela.
   */
  heldByRecentBreach: boolean;
  /**
   * true quando o lado quente trocou em relação ao normal do ativo, e a troca
   * é maior que o limite — não um zero-crossing de ruído.
   */
  inverted: boolean;
  /** qual dos dois está mais quente: 'A', 'B' ou null quando empatam */
  hotter: 'A' | 'B' | null;
  /** por que não há comparação, quando status = SEM_DADOS */
  reason?: string;

  /** ocorrências abertas neste ativo — independe do estado dos sensores */
  openOccurrences: number;
  /** nome do status mais severo entre as abertas */
  occurrenceStatus: string | null;
  occurrenceStatusId: number | null;
  /** abertura mais antiga ainda em aberto */
  occurrenceOpenedAt: string | null;
}

export interface BoardResult {
  pairs: PairState[];
  settings: {
    thresholdC: number;
    toleranceMs: number;
    temperatureOffsetC: number;
    /** por quantas horas um rompimento mantém o ativo em risco */
    riskHoldHours: number;
    /** aceleração RMS mínima, em g, para o sensor contar como montado */
    mountedMinAccG: number;
    /** quanto o sensor solto precisa estar mais frio que o par, em °C */
    offMachineMinTempGapC: number;
  };
  generatedAt: number;
}

export interface AnalysisResult {
  pointA: PositionInfo;
  pointB: PositionInfo;
  seriesA: TempSample[];
  seriesB: TempSample[];
  /** vibração de cada ponto, para os gráficos de aceleração e velocidade */
  vibrationA: VibrationSample[];
  vibrationB: VibrationSample[];
  pairs: ComparedPair[];
  discarded: DiscardedSample[];
  diagnostics: PairingDiagnostics;
  settings: {
    thresholdC: number;
    toleranceMs: number;
    days: number;
    /** correção subtraída de toda leitura de temperatura, em °C */
    temperatureOffsetC: number;
    /** aceleração RMS mínima deste par para o sensor contar como montado */
    mountedMinAccG: number;
    /** true quando esse mínimo veio do ativo, não do padrão */
    mountedIsCustom: boolean;
    /** quanto o sensor solto precisa estar mais frio que o par, em °C */
    offMachineMinTempGapC: number;
  };
  summary: {
    /** par válido mais recente — o que define o estado atual do painel */
    latest: ComparedPair | null;
    /** estado atual: alarme quando o último par válido rompe o limite */
    status: 'ALARME' | 'NORMAL' | 'SEM_DADOS';
    alarmCount: number;
    alarmRatio: number;
    maxAbsDelta: number | null;
    avgAbsDelta: number | null;
    /** há quanto tempo o desvio está continuamente acima do limite, em ms */
    alarmStreakMs: number | null;
  };
}
