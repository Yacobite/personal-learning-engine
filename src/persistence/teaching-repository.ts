import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { TeachingRepository } from '../ports/teaching-repository.ts';
import { TeachingError } from '../domain/teaching.ts';
import type { TeachingMove, TeachingSession, TeachingState, TeachingSummary, Scaffold } from '../domain/teaching.ts';
import type { EvaluationWrite } from '../domain/assessment.ts';
type Row = Record<string, SQLOutputValue>;
export class SqliteTeachingRepository implements TeachingRepository {
    private readonly db: DatabaseSync;
    constructor(db: DatabaseSync) { this.db = db; }
    private transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try {
        const v = fn();
        this.db.exec('COMMIT');
        return v;
    }
    catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
    } }
    private session(r: Row): TeachingSession { return { id: String(r.id), courseId: String(r.course_id), curriculumVersion: Number(r.curriculum_version), policy: String(r.policy), diagnosticId: r.diagnostic_id === null ? null : String(r.diagnostic_id), recommendations: JSON.parse(String(r.recommendations_json)), budget: Number(r.budget), status: r.status as TeachingSession['status'], startedAt: String(r.started_at), endedAt: r.ended_at === null ? null : String(r.ended_at), summary: r.summary_json === null ? null : JSON.parse(String(r.summary_json)), state: JSON.parse(String(r.state_json)), revision: Number(r.revision) }; }
    get(courseId: string, id: string) { const r = this.db.prepare('SELECT * FROM teaching_sessions WHERE course_id=? AND id=?').get(courseId, id); return r ? this.session(r) : undefined; }
    current(courseId: string) { const r = this.db.prepare("SELECT * FROM teaching_sessions WHERE course_id=? AND status='in_progress'").get(courseId); return r ? this.session(r) : undefined; }
    history(courseId: string) { return this.db.prepare('SELECT * FROM teaching_sessions WHERE course_id=? ORDER BY started_at,id').all(courseId).map(r => this.session(r)); }
    start(s: TeachingSession) { return this.transaction(() => { if (this.current(s.courseId))
        throw new TeachingError('Teaching session already active.'); this.db.prepare('INSERT INTO teaching_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(s.id, s.courseId, s.curriculumVersion, s.policy, s.diagnosticId, JSON.stringify(s.recommendations), s.budget, s.status, s.startedAt, null, null, JSON.stringify(s.state), s.revision); return this.get(s.courseId, s.id)!; }); }
    moves(courseId: string, sessionId: string): TeachingMove[] { return this.db.prepare('SELECT * FROM teaching_moves WHERE course_id=? AND session_id=? ORDER BY sequence').all(courseId, sessionId).map(r => ({ id: String(r.id), courseId, sessionId, curriculumVersion: Number(r.curriculum_version), sequence: Number(r.sequence), conceptId: String(r.concept_id), type: r.type as TeachingMove['type'], reason: String(r.reason), level: Number(r.level) as Scaffold, content: JSON.parse(String(r.content_json)), taskId: r.task_id === null ? null : String(r.task_id), attemptId: r.attempt_id === null ? null : String(r.attempt_id), status: r.status as TeachingMove['status'], createdAt: String(r.created_at), outcomes: this.db.prepare('SELECT * FROM teaching_outcomes WHERE course_id=? AND move_id=? ORDER BY rowid').all(courseId, String(r.id)).map(o => ({ evaluationId: String(o.evaluation_id), evidenceId: o.evidence_id === null ? null : String(o.evidence_id) })) })); }
    insert(m: TeachingMove, revision: number, state: TeachingState, hintFor: string | null) {
        if (!this.db.isTransaction)
            throw new TeachingError('Teaching insertion requires an enclosing transaction.');
        const changed = this.db.prepare("UPDATE teaching_sessions SET state_json=?,revision=revision+1 WHERE course_id=? AND id=? AND revision=? AND status='in_progress'").run(JSON.stringify(state), m.courseId, m.sessionId, revision);
        if (!changed.changes)
            throw new TeachingError('Teaching advanced during generation; retry.');
        this.db.prepare('INSERT INTO teaching_moves VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(m.id, m.courseId, m.sessionId, m.curriculumVersion, m.sequence, m.conceptId, m.type, m.reason, m.level, JSON.stringify(m.content), m.taskId, null, m.status, m.createdAt);
        if (hintFor)
            this.db.prepare('INSERT INTO teaching_support VALUES (?,?,?)').run(m.courseId, hintFor, m.id);
    }
    content(m: TeachingMove, revision: number, state: TeachingState, hintFor: string | null) { this.transaction(() => this.insert(m, revision, state, hintFor)); }
    support(courseId: string, moveId: string) { const r = this.db.prepare('SELECT count(*) AS count,coalesce(max(h.level),0) AS level FROM teaching_support s JOIN teaching_moves h ON h.id=s.hint_move_id WHERE s.course_id=? AND s.task_move_id=?').get(courseId, moveId)!; const m = this.db.prepare('SELECT level FROM teaching_moves WHERE course_id=? AND id=?').get(courseId, moveId); return { count: Number(r.count) + (Number(m?.level) > 0 ? 1 : 0), level: Math.max(Number(r.level), Number(m?.level ?? 0)) as Scaffold }; }
    attachAttempt(courseId: string, id: string, attemptId: string) { this.transaction(() => { const m = this.db.prepare('SELECT * FROM teaching_moves WHERE course_id=? AND id=?').get(courseId, id); if (m?.attempt_id === attemptId)
        return; if (!m || m.status !== 'outstanding')
        throw new TeachingError('Move cannot accept another attempt.'); this.db.prepare("UPDATE teaching_moves SET attempt_id=?,status='answered' WHERE course_id=? AND id=?").run(attemptId, courseId, id); }); }
    attachOutcome(courseId: string, id: string, w: EvaluationWrite) { this.transaction(() => { if (this.db.prepare('SELECT 1 FROM teaching_outcomes WHERE move_id=? AND evaluation_id=?').get(id, w.evaluation.id))
        return; this.db.prepare('INSERT INTO teaching_outcomes VALUES (?,?,?,?,?)').run(courseId, id, w.evaluation.attemptId, w.evaluation.id, w.evidence?.id ?? null); if (w.evaluation.status !== 'failed')
        this.db.prepare("UPDATE teaching_moves SET status='resolved' WHERE course_id=? AND id=?").run(courseId, id); }); }
    finish(courseId: string, id: string, summary: TeachingSummary, state: TeachingState) { return this.transaction(() => { this.db.prepare("UPDATE teaching_sessions SET status=?,ended_at=?,summary_json=?,state_json=? WHERE course_id=? AND id=? AND status='in_progress'").run(summary.stopReason === 'learner_stopped' ? 'abandoned' : 'completed', summary.asOf, JSON.stringify(summary), JSON.stringify(state), courseId, id); return this.get(courseId, id)!; }); }
}
