import { useEffect, useState } from 'react';
import type { PairState } from '../types';
import { c1, signed1, stamp, stampFull, shortName } from '../format.en';

interface Props {
  pair: PairState;
  /** For how many hours a breach keeps the asset at risk. */
  riskHoldHours: number;
  /** Minimum acceleration RMS, in g, for a sensor to count as mounted. */
  mountedMinAccG: number;
  onRemove: (id: string) => void;
  onAnalyse: (id: string) => void;
  /** Ajuste do limite direto no card, sem abrir o dialogo. */
  onQuickLimit: (id: string, thresholdC: number) => void;
}

const W = 440;
const H = 200;

/**
 * The asset as a twin: two bearings with the roll between them and a sensor on
 * top of each bearing. The hotter bearing lights up; on failure it and its
 * sensor pulse red. The geometry is the same for every asset — what changes is
 * which side heats up.
 */
export default function AssetTwin({
  pair, riskHoldHours, mountedMinAccG, onRemove, onAnalyse, onQuickLimit,
}: Props) {
  /**
   * Rascunho do limite. Fica local enquanto se digita e só sobe ao confirmar,
   * senão cada tecla dispararia uma gravação e uma recarga do painel.
   */
  const [draft, setDraft] = useState(String(pair.thresholdC));
  useEffect(() => setDraft(String(pair.thresholdC)), [pair.thresholdC]);

  const parsed = Number(draft);
  const draftValid = Number.isFinite(parsed) && parsed > 0;
  const draftChanged = draftValid && parsed !== pair.thresholdC;

  function commit() {
    if (draftChanged) onQuickLimit(pair.id, parsed);
    else setDraft(String(pair.thresholdC));
  }
  // Cada ativo traz o seu limite; o global é só o padrão de quem não definiu.
  const thresholdC = pair.thresholdC;
  const alarm = pair.status === 'ALARME';
  const noData = pair.status === 'SEM_DADOS';
  /**
   * Sensor solto invalida a comparação: ele lê o ambiente, não o mancal. Nada
   * de falha de lubrificação enquanto isso não for resolvido.
   */
  const offA = pair.offMachineA;
  const offB = pair.offMachineB;
  const sensorOff = pair.status === 'SENSOR_FORA';

  const hotA = pair.hotter === 'A';
  const hotB = pair.hotter === 'B';

  // Only the hot side goes into alarm: that is the one that lost lubrication.
  const breaching = alarm && !pair.heldByRecentBreach;
  const alarmA = breaching && hotA;
  const alarmB = breaching && hotB;

  /**
   * The hot side is only tinted once the deviation approaches the limit.
   * Without this, a few tenths of a degree — normal between two bearings —
   * would paint a bearing orange and imply a problem that is not there.
   */
  const magnitude = Math.abs(pair.delta ?? 0);
  // Com a comparação suspensa o desvio não significa nada — não pode tingir mancal.
  const warming = !alarm && !noData && !sensorOff && magnitude >= thresholdC * 0.6;

  const colorFor = (isAlarm: boolean, warm: boolean) =>
    isAlarm ? 'var(--critical)' : warm ? 'var(--serious)' : 'var(--surface-2)';

  const bearingA = colorFor(alarmA, warming && hotA);
  const bearingB = colorFor(alarmB, warming && hotB);

  const offName = offA ? shortName(pair.pointA.name) : offB ? shortName(pair.pointB.name) : null;
  const offAcc = offA ? pair.peakAccA : offB ? pair.peakAccB : null;
  /** A evidência numérica vive no tooltip: o card fica com a conclusão. */
  const offEvidence =
    offName != null && offAcc != null
      ? `${offName} reads ${offAcc.toFixed(4)} g, below the ${mountedMinAccG} g needed to count as mounted, while its pair vibrates well above it.`
      : undefined;

  const assetLabel = pair.assetName ?? `Asset ${pair.assetId}`;

  /**
   * Ocorrência é do ativo e independe do estado dos sensores: um ativo pode
   * estar com a comparação suspensa e ainda assim ter ocorrência aberta.
   * Severidade cresce com o sysStatusId (1 normal … 7 crítico).
   */
  const hasOccurrence = pair.openOccurrences > 0;
  const occSeverity =
    pair.occurrenceStatusId != null && pair.occurrenceStatusId >= 5
      ? 'var(--critical)'
      : pair.occurrenceStatusId != null && pair.occurrenceStatusId >= 3
        ? 'var(--warning)'
        : 'var(--text-muted)';

  return (
    <article
      className={`twin${alarm ? ' is-alarm' : ''}${noData ? ' is-nodata' : ''}${sensorOff ? ' is-sensoroff' : ''}`}
    >
      <header className="twin-head">
        <div className="twin-id">
          <h3>{assetLabel}</h3>
          <p>{pair.facilityName}</p>
        </div>
        <div className="twin-head-right">
          {alarm && (
            <span
              className="badge badge-alarm"
              title={
                pair.heldByRecentBreach && pair.lastBreachAt != null
                  ? `Within the limit right now, but it broke the limit ${pair.breachCount}× in the last ${riskHoldHours} h — most recently at ${stampFull(pair.lastBreachAt)}.`
                  : undefined
              }
            >
              ⚠ Lubrication failure
            </span>
          )}
          {pair.inverted && (
            <span
              className="badge badge-inverted"
              title={`This asset normally runs at ${signed1(pair.baselineC ?? 0)}; the hot side has swapped.`}
            >
              ⇄ Side inversion
            </span>
          )}
          {sensorOff && (
            <span
              className="badge badge-sensoroff"
              title={offEvidence}
            >
              ⚟ Sensor off the machine
            </span>
          )}
          {pair.status === 'NORMAL' && !pair.inverted && (
            <span className="badge badge-ok">✓ Normal</span>
          )}
          {noData && <span className="badge badge-idle">— No reading</span>}
          <button
            className="icon-btn"
            title="Open in Analytics"
            aria-label={`Analyse ${assetLabel}`}
            onClick={() => onAnalyse(pair.id)}
          >
            ↗
          </button>
          <button
            className="icon-btn"
            title="Remove this pair from the board"
            aria-label={`Remove ${assetLabel} from the board`}
            onClick={() => onRemove(pair.id)}
          >
            ✕
          </button>
        </div>
      </header>

      <svg className="twin-svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`${assetLabel}: ${pair.pointA.name} at ${pair.pointA.temp?.toFixed(1) ?? '—'} degrees, ${pair.pointB.name} at ${pair.pointB.temp?.toFixed(1) ?? '—'} degrees.`}>

        {/* machine base */}
        <rect x={34} y={158} width={372} height={11} rx={3} fill="var(--surface-2)" stroke="var(--border)" />
        <rect x={44} y={169} width={26} height={7} rx={2} fill="var(--border)" />
        <rect x={370} y={169} width={26} height={7} rx={2} fill="var(--border)" />

        {/* shaft running through both bearings */}
        <rect x={104} y={110} width={232} height={13} rx={3} fill="var(--border-strong)" />

        {/* roll / asset body */}
        <rect x={146} y={82} width={148} height={70} rx={7}
          fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth={1.5} />
        <line x1={146} y1={116} x2={294} y2={116} stroke="var(--border)" strokeWidth={1} />

        {/* bearing A */}
        <rect x={62} y={92} width={52} height={66} rx={5}
          fill={bearingA} stroke={alarmA ? 'var(--critical)' : 'var(--border-strong)'}
          strokeWidth={alarmA ? 2.5 : 1.5}
          className={alarmA ? 'alarm-fill' : undefined}
          opacity={noData ? 0.45 : 1} />
        <circle cx={88} cy={116} r={9} fill="var(--surface-1)" stroke="var(--border-strong)" strokeWidth={1.5} />

        {/* bearing B */}
        <rect x={326} y={92} width={52} height={66} rx={5}
          fill={bearingB} stroke={alarmB ? 'var(--critical)' : 'var(--border-strong)'}
          strokeWidth={alarmB ? 2.5 : 1.5}
          className={alarmB ? 'alarm-fill' : undefined}
          opacity={noData ? 0.45 : 1} />
        <circle cx={352} cy={116} r={9} fill="var(--surface-1)" stroke="var(--border-strong)" strokeWidth={1.5} />

        {/* sensor stem A */}
        <line x1={88} y1={92} x2={88} y2={72}
          stroke={offA ? 'var(--warning)' : 'var(--border-strong)'} strokeWidth={2}
          strokeDasharray={offA ? '3 3' : undefined} />
        <circle cx={88} cy={64} r={9}
          fill={alarmA ? 'var(--critical)' : offA ? 'none' : 'var(--series-a)'}
          stroke={offA ? 'var(--warning)' : 'var(--surface-1)'}
          strokeWidth={2.5}
          strokeDasharray={offA ? '3 3' : undefined}
          className={alarmA ? 'alarm-mark' : undefined} />

        {/* sensor stem B */}
        <line x1={352} y1={92} x2={352} y2={72}
          stroke={offB ? 'var(--warning)' : 'var(--border-strong)'} strokeWidth={2}
          strokeDasharray={offB ? '3 3' : undefined} />
        <circle cx={352} cy={64} r={9}
          fill={alarmB ? 'var(--critical)' : offB ? 'none' : 'var(--series-b)'}
          stroke={offB ? 'var(--warning)' : 'var(--surface-1)'}
          strokeWidth={2.5}
          strokeDasharray={offB ? '3 3' : undefined}
          className={alarmB ? 'alarm-mark' : undefined} />

        {/* reading A, with the moment it arrived */}
        <text x={88} y={30} textAnchor="middle" className="twin-temp"
          opacity={offA ? 0.4 : 1}
          fill={alarmA ? 'var(--critical)' : 'var(--text-primary)'}>
          {pair.pointA.temp != null ? c1(pair.pointA.temp) : '—'}
        </text>
        {pair.pointA.t != null && (
          <text x={88} y={46} textAnchor="middle" className="twin-when">
            {stamp(pair.pointA.t)}
          </text>
        )}

        {/* reading B, with the moment it arrived */}
        <text x={352} y={30} textAnchor="middle" className="twin-temp"
          opacity={offB ? 0.4 : 1}
          fill={alarmB ? 'var(--critical)' : 'var(--text-primary)'}>
          {pair.pointB.temp != null ? c1(pair.pointB.temp) : '—'}
        </text>
        {pair.pointB.t != null && (
          <text x={352} y={46} textAnchor="middle" className="twin-when">
            {stamp(pair.pointB.t)}
          </text>
        )}

        {/* deviation, at the centre of the roll */}
        {sensorOff && (
          <text x={220} y={120} textAnchor="middle" className="twin-delta-sub">
            comparison suspended
          </text>
        )}
        {pair.delta != null && !sensorOff && (
          <>
            <text x={220} y={112} textAnchor="middle" className="twin-delta"
              fill={alarm ? 'var(--critical)' : 'var(--text-secondary)'}>
              {signed1(pair.delta)}
            </text>
            <text x={220} y={132} textAnchor="middle" className="twin-delta-sub">
              limit {thresholdC} °C
              {pair.deviationMode === 'RELATIVE'
                ? ` · vs normal ${signed1(pair.deviationReference)}`
                : pair.baselineC != null
                  ? ` · normal ${signed1(pair.baselineC)}`
                  : ''}
            </text>
          </>
        )}
        {noData && (
          <text x={220} y={120} textAnchor="middle" className="twin-delta-sub">
            no comparison
          </text>
        )}
      </svg>

      <footer className="twin-foot">
        <span className="twin-point">
          <i className="dot" style={{ background: alarmA ? 'var(--critical)' : 'var(--series-a)' }} />
          {shortName(pair.pointA.name)}
        </span>
        <span className="twin-point twin-point-right">
          {shortName(pair.pointB.name)}
          <i className="dot" style={{ background: alarmB ? 'var(--critical)' : 'var(--series-b)' }} />
        </span>
      </footer>

      <div className="twin-quick">
        <label htmlFor={`lim-${pair.id}`}>Limit</label>
        <input
          id={`lim-${pair.id}`}
          type="number"
          step="0.5"
          min="0.5"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setDraft(String(pair.thresholdC));
          }}
        />
        <span className="unit">°C</span>
        {draftChanged && <span className="twin-quick-hint">press Enter to save</span>}
        {!draftValid && <span className="twin-quick-warn">must be &gt; 0</span>}
        {pair.thresholdIsCustom && !draftChanged && (
          <span className="twin-quick-tag">asset</span>
        )}
      </div>

      <p className={`twin-occ${hasOccurrence ? ' is-open' : ''}`}>
        {hasOccurrence ? (
          <>
            <i className="dot" style={{ background: occSeverity }} />
            <strong>
              {pair.openOccurrences} open occurrence{pair.openOccurrences === 1 ? '' : 's'}
            </strong>
            {pair.occurrenceStatus && <> · {pair.occurrenceStatus}</>}
            {pair.occurrenceOpenedAt && (
              <> · since {stamp(new Date(pair.occurrenceOpenedAt).getTime())}</>
            )}
          </>
        ) : (
          <>
            <i className="dot" style={{ background: 'var(--border-strong)' }} />
            No open occurrence
          </>
        )}
      </p>

      {sensorOff && offName && (
        <p className="twin-sensoroff">
          These two sensors do not appear to be on the same roll.{' '}
          <strong>Inspection requested.</strong>
        </p>
      )}
      {pair.heldByRecentBreach && pair.lastBreachAt != null && (
        <p className="twin-held">
          Within the limit now · broke it {pair.breachCount}× in the last {riskHoldHours} h,
          last at {stamp(pair.lastBreachAt)}
        </p>
      )}
      {noData && pair.reason && <p className="twin-reason">{pair.reason}</p>}
    </article>
  );
}
