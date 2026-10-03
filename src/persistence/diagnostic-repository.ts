import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { DiagnosticError } from '../domain/diagnostic.ts';
import type { DiagnosticSession, DiagnosticProbe, DiagnosticSummary } from '../domain/diagnostic.ts';
import type { EvaluationWrite } from '../domain/assessment.ts';
import type { DiagnosticRepository } from '../ports/diagnostic-repository.ts';
type Row = Record<string, SQLOutputValue>;
export class SqliteDiagnosticRepository implements DiagnosticRepository {
    private readonly db: DatabaseSync;
    constructor(db: DatabaseSync) { this.db = db; }
    private transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try {
        const r = fn();
        this.db.exec('COMMIT');
        return r;
    }
    catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
    } }
    private session(r: Row): DiagnosticSession {
        return { id: String(r.id), courseId: String(r.course_id), curriculumVersion: Number(r.curriculum_version), policy: String(r.policy), budget: Number(r.budget), status: String(r.status) as DiagnosticSession['status'],
            startedAt: String(r.started_at), endedAt: r.ended_at === null ? null : String(r.ended_at), stopReason: r.stop_reason === null ? null : String(r.stop_reason) as DiagnosticSession['stopReason'],
            summary: r.summary_json === null ? null : JSON.parse(String(r.summary_json)) as DiagnosticSummary,
            priorAttemptIds: this.db.prepare('SELECT attempt_id FROM diagnostic_prior_attempts WHERE session_id=? ORDER BY attempt_id').all(String(r.id)).map(a => String(a.attempt_id)) };
    }
    get(courseId: string, id: string) { const r = this.db.prepare('SELECT * FROM diagnostic_sessions WHERE course_id=? AND id=?').get(courseId, id); return r ? this.session(r) : undefined; }
    current(courseId: string) { const r = this.db.prepare("SELECT * FROM diagnostic_sessions WHERE course_id=? AND status='in_progress'").get(courseId); return r ? this.session(r) : undefined; }
    history(courseId: string) { return this.db.prepare('SELECT * FROM diagnostic_sessions WHERE course_id=? ORDER BY started_at,id').all(courseId).map(r => this.session(r)); }
    start(s: DiagnosticSession) {
        return this.transaction(() => {
            const existing = this.current(s.courseId);
            if (existing) {
                if (existing.budget !== s.budget)
                    throw new DiagnosticError('Active diagnostic has a different budget; resume or abandon it first.');
                return existing;
            }
            for (const id of s.priorAttemptIds)
                this.db.prepare('INSERT INTO diagnostic_prior_attempts VALUES (?,?,?)').run(s.id, s.courseId, id);
            this.db.prepare('INSERT INTO diagnostic_sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(s.id, s.courseId, s.curriculumVersion, s.policy, s.budget, s.status, s.startedAt, null, null, null);
            return this.get(s.courseId, s.id)!;
        });
    }
    probes(courseId: string, sessionId: string): DiagnosticProbe[] {
        return this.db.prepare('SELECT * FROM diagnostic_probes WHERE course_id=? AND session_id=? ORDER BY sequence').all(courseId, sessionId).map(r => ({
            id: String(r.id), courseId, sessionId, curriculumVersion: Number(r.curriculum_version), sequence: Number(r.sequence), conceptId: String(r.concept_id), taskId: String(r.task_id), attemptId: r.attempt_id === null ? null : String(r.attempt_id),
            status: String(r.status) as DiagnosticProbe['status'], selectionReason: String(r.selection_reason), createdAt: String(r.created_at), answeredAt: r.answered_at === null ? null : String(r.answered_at), resolvedAt: r.resolved_at === null ? null : String(r.resolved_at),
            outcomes: this.db.prepare('SELECT * FROM diagnostic_probe_outcomes WHERE probe_id=? ORDER BY ordinal').all(String(r.id)).map(o => ({ evaluationId: String(o.evaluation_id), evidenceId: o.evidence_id === null ? null : String(o.evidence_id) }))
        }));
    }
    /** Called inside the M4 task transaction; never starts a nested transaction. */
    insertProbe(p: DiagnosticProbe) {
        if (!this.db.isTransaction)
            throw new DiagnosticError('Probe insertion requires the task transaction.');
        this.db.prepare('INSERT INTO diagnostic_probes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(p.id, p.courseId, p.sessionId, p.curriculumVersion, p.sequence, p.conceptId, p.taskId, null, 'outstanding', p.selectionReason, p.createdAt, null, null);
    }
    attachAttempt(courseId: string, probeId: string, attemptId: string, at: string) {
        this.transaction(() => {
            const r = this.db.prepare('SELECT attempt_id,status FROM diagnostic_probes WHERE course_id=? AND id=?').get(courseId, probeId);
            if (!r)
                throw new DiagnosticError('Probe not found.');
            if (r.attempt_id === attemptId)
                return;
            if (r.status !== 'outstanding')
                throw new DiagnosticError('Probe cannot accept another attempt.');
            this.db.prepare("UPDATE diagnostic_probes SET attempt_id=?,status='answered',answered_at=? WHERE course_id=? AND id=?").run(attemptId, at, courseId, probeId);
        });
    }
    attachOutcome(courseId: string, probeId: string, w: EvaluationWrite, at: string) {
        this.transaction(() => {
            if (this.db.prepare('SELECT 1 FROM diagnostic_probe_outcomes WHERE probe_id=? AND evaluation_id=?').get(probeId, w.evaluation.id))
                return;
            this.db.prepare('INSERT INTO diagnostic_probe_outcomes(course_id,probe_id,attempt_id,evaluation_id,evidence_id) VALUES (?,?,?,?,?)').run(courseId, probeId, w.evaluation.attemptId, w.evaluation.id, w.evidence?.id ?? null);
            if (w.evaluation.status !== 'failed')
                this.db.prepare("UPDATE diagnostic_probes SET status='resolved',resolved_at=? WHERE course_id=? AND id=?").run(at, courseId, probeId);
        });
    }
    skip(courseId: string, probeId: string, at: string) { const r = this.db.prepare("UPDATE diagnostic_probes SET status='skipped',resolved_at=? WHERE course_id=? AND id=? AND status='outstanding'").run(at, courseId, probeId); if (!r.changes)
        throw new DiagnosticError('Only an unanswered probe can be skipped.'); }
    finish(courseId: string, sessionId: string, status: 'completed' | 'abandoned', summary: DiagnosticSummary) {
        return this.transaction(() => {
            if (status === 'completed' && this.probes(courseId, sessionId).some(p => p.status === 'outstanding' || p.status === 'answered'))
                throw new DiagnosticError('Resolve or skip the pending probe first.');
            this.db.prepare('UPDATE diagnostic_sessions SET status=?,ended_at=?,stop_reason=?,summary_json=? WHERE course_id=? AND id=?').run(status, summary.asOf, summary.stopReason, JSON.stringify(summary), courseId, sessionId);
            return this.get(courseId, sessionId)!;
        });
    }
}
