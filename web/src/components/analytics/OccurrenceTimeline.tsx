import type { OccurrenceRecord } from '../../types';
import { stampFull } from '../../format.en';

interface Props {
  occurrences: OccurrenceRecord[];
  loading: boolean;
}

/** Severidade cresce com o sysStatusId: 1 normal … 7 crítico. */
function severityColor(statusId: number | null): string {
  if (statusId == null) return 'var(--text-muted)';
  if (statusId >= 5) return 'var(--critical)';
  if (statusId >= 3) return 'var(--warning)';
  return 'var(--text-muted)';
}

/** Um veredito de três estados: sim, não, ou ainda não julgado. */
function Verdict({ label, value }: { label: string; value: boolean | null }) {
  if (value == null) return null;
  return (
    <span className={`verdict${value ? ' is-yes' : ' is-no'}`}>
      {value ? '✓' : '✕'} {label}
    </span>
  );
}

/**
 * Ciclo de vida das ocorrências do ativo: quando abriu e por quem, qual
 * diagnóstico, quando encerrou, por quem, e se a análise foi considerada
 * válida. Mais recente primeiro.
 */
export default function OccurrenceTimeline({ occurrences, loading }: Props) {
  if (loading) return <p className="muted">Loading occurrences…</p>;
  if (occurrences.length === 0) {
    return <p className="muted">No occurrences recorded for this asset.</p>;
  }

  return (
    <ol className="timeline">
      {occurrences.map((o) => {
        const open = o.closedAt == null;
        return (
          <li key={o.id} className={`tl-item${open ? ' is-open' : ''}`}>
            <span className="tl-marker" style={{ background: severityColor(o.statusId) }} />

            <div className="tl-body">
              <header className="tl-head">
                <span className="tl-status" style={{ color: severityColor(o.statusId) }}>
                  {o.status ?? 'occurrence'}
                </span>
                <span className={`tl-state${open ? ' is-open' : ''}`}>
                  {open ? '● Open' : '○ Closed'}
                </span>
                <span className="tl-id">#{o.id}</span>
              </header>

              {/* Abertura */}
              <div className="tl-row">
                <span className="tl-when">{stampFull(new Date(o.openedAt).getTime())}</span>
                <span className="tl-what">
                  Opened by <strong>{o.openedBy ?? 'the system'}</strong>
                  {!o.manuallyOpened && o.openedBy == null && ' (automatic)'}
                </span>
              </div>

              {/* Diagnósticos */}
              {o.diagnostics.map((d) => (
                <div className="tl-row tl-diag" key={d.id}>
                  <span className="tl-when">{stampFull(new Date(d.createdAt).getTime())}</span>
                  <div className="tl-what">
                    <span className="tl-diag-name">
                      {d.label ?? d.diagnostic ?? 'Diagnostic'}
                    </span>
                    <span className="tl-by">
                      by <strong>{d.createdBy ?? (d.createdByAI ? 'Copilot' : '—')}</strong>
                      {d.createdByAI && <em className="tl-ai">AI</em>}
                    </span>
                    {d.recommendation && (
                      <p className="tl-note">
                        <b>Recommendation</b> {d.recommendation}
                      </p>
                    )}
                    {d.rootCause && (
                      <p className="tl-note">
                        <b>Root cause</b> {d.rootCause}
                      </p>
                    )}
                    {/* Parecer escrito no diagnóstico — distinto do comentário
                        de fechamento, que vem mais abaixo. */}
                    {d.comments && (
                      <p className="tl-note">
                        <b>Analyst note</b> {d.comments}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {/* Encerramento, com o comentário escrito na hora de fechar */}
              {o.closedAt ? (
                <div className="tl-row">
                  <span className="tl-when">{stampFull(new Date(o.closedAt).getTime())}</span>
                  <div className="tl-what">
                    Closed by <strong>{o.closedBy ?? 'the system'}</strong>
                    {o.closingComment ? (
                      <p className="tl-note tl-comment">
                        <b>Closing comment</b> {o.closingComment}
                      </p>
                    ) : (
                      <p className="tl-note tl-nocomment">No closing comment</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="tl-row">
                  <span className="tl-when">—</span>
                  <span className="tl-what tl-pending">Still open</span>
                </div>
              )}

              {(o.validAnalysis != null ||
                o.validDiagnostic != null ||
                o.hadIntervention != null) && (
                <div className="tl-verdicts">
                  <Verdict label="analysis valid" value={o.validAnalysis} />
                  <Verdict label="diagnostic valid" value={o.validDiagnostic} />
                  <Verdict label="intervention done" value={o.hadIntervention} />
                </div>
              )}

              {o.comments && (
                <p className="tl-note">
                  <b>Occurrence note</b> {o.comments}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
