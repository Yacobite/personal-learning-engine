import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { ReviewRepository } from '../ports/review-repository.ts';
import { ReviewError, validateReview } from '../domain/review.ts';
import type { ReviewItem, ReviewEvent, ReviewStatus } from '../domain/review.ts';
import type { EvaluationWrite } from '../domain/assessment.ts';
type Row = Record<string, SQLOutputValue>;
export class SqliteReviewRepository implements ReviewRepository {
    private readonly db: DatabaseSync;
    constructor(db: DatabaseSync) { this.db = db; }
    private transaction<T>(run: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = run();
            this.db.exec('COMMIT');
            return result;
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
    }
    private map(r: Row): ReviewItem {
        return { id: String(r.id), courseId: String(r.course_id), curriculumVersion: Number(r.curriculum_version), conceptId: String(r.concept_id),
            kind: r.kind as ReviewItem['kind'], dimension: r.dimension as ReviewItem['dimension'], type: r.type as ReviewItem['type'], representation: r.representation as ReviewItem['representation'],
            novelty: r.novelty as ReviewItem['novelty'], assistance: 'none', earliestAt: String(r.earliest_at), dueAt: String(r.due_at), stage: Number(r.stage),
            stateRevisionId: String(r.state_revision_id), gapId: r.gap_id === null ? null : String(r.gap_id), policies: JSON.parse(String(r.policies_json)), basis: String(r.basis), episode: String(r.episode), createdAt: String(r.created_at),
            status: r.status as ReviewStatus, taskId: r.task_id === null ? null : String(r.task_id), attemptId: r.attempt_id === null ? null : String(r.attempt_id), completedAt: r.completed_at === null ? null : String(r.completed_at) };
    }
    list(courseId: string) { return this.db.prepare('SELECT i.*,p.status,p.task_id,p.attempt_id,p.completed_at FROM review_items i JOIN review_progress p ON p.item_id=i.id WHERE i.course_id=? ORDER BY i.created_at,i.id').all(courseId).map(r => this.map(r)); }
    get(courseId: string, id: string) {
        const row = this.db.prepare('SELECT i.*,p.status,p.task_id,p.attempt_id,p.completed_at FROM review_items i JOIN review_progress p ON p.item_id=i.id WHERE i.course_id=? AND i.id=?').get(courseId,id);
        return row ? this.map(row) : undefined;
    }
    private event(i: ReviewItem, kind: ReviewEvent['kind'], at: string, reason: string, evaluationId: string | null = null, evidenceId: string | null = null) {
        this.db.prepare('INSERT INTO review_events(course_id,item_id,kind,at,reason,evaluation_id,evidence_id) VALUES (?,?,?,?,?,?,?)').run(i.courseId, i.id, kind, at, reason, evaluationId, evidenceId);
    }
    reconcile(courseId: string, stateRevisionId: string, at: string, build: (history: ReviewItem[]) => ReviewItem[], fingerprint: string) {
        this.transaction(() => {
            const history = this.list(courseId), desired = build(history);
            for (const i of desired) {
                validateReview(i);
                if (i.courseId !== courseId)
                    throw new ReviewError('Review reconciliation scope mismatch.');
            }
            const bases = new Set(desired.map(i => i.basis));
            for (const i of history.filter(i => i.status === 'scheduled' || (i.status === 'active' && !i.attemptId))) {
                if (!bases.has(i.basis))
                    this.change(i, 'superseded', at, 'M7 state or active curriculum changed: ' + stateRevisionId);
            }
            for (const i of desired) {
                if (history.some(h => h.basis === i.basis && ['scheduled', 'active', 'awaiting_evaluation'].includes(h.status)))
                    continue;
                // Structurally unavailable/cancelled requirements stay audited and do not loop on refresh.
                if (history.some(h => h.basis === i.basis && (h.status === 'cancelled' || h.status === 'superseded') && this.events(courseId, h.id).some(e => e.reason === 'no_evaluable_review_task')))
                    continue;
                this.db.prepare('INSERT INTO review_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(i.id, i.courseId, i.curriculumVersion, i.conceptId, i.kind, i.dimension, i.type, i.representation, i.novelty, i.assistance, i.earliestAt, i.dueAt, i.stage, i.stateRevisionId, i.gapId, JSON.stringify(i.policies), i.basis, i.episode, i.createdAt);
                this.db.prepare('INSERT INTO review_progress VALUES (?,?,?,?,?,?,?,?)').run(i.id, courseId, i.curriculumVersion, i.basis, 'scheduled', null, null, null);
                this.event(i, 'scheduled', at, 'M7 scheduling requirement');
            }
            this.db.prepare('INSERT OR IGNORE INTO review_reconciliations(course_id,state_revision_id,at,fingerprint) VALUES (?,?,?,?)').run(courseId, stateRevisionId, at, fingerprint);
        });
    }
    linkTask(courseId: string, id: string, taskId: string, at: string, stateRevisionId: string) {
        const i = this.get(courseId, id);
        if (!i || i.status !== 'scheduled' || at < i.earliestAt)
            throw new ReviewError('Review selection changed or is not eligible.');
        const current = this.db.prepare('SELECT revision_id FROM learner_current WHERE course_id=? AND curriculum_version=?').get(courseId, i.curriculumVersion);
        if (current?.revision_id !== stateRevisionId)
            throw new ReviewError('M7 state changed during review generation; retry.');
        this.db.prepare("UPDATE review_progress SET status='active',task_id=? WHERE item_id=?").run(taskId, id);
        this.event(i, 'active', at, 'eligible review selected');
        this.event(i, 'task_linked', at, taskId);
    }
    attachAttempt(courseId: string, id: string, attemptId: string, at: string) {
        this.transaction(() => {
            const i = this.get(courseId, id);
            if (!i)
                throw new ReviewError('Review not found.');
            if (i.attemptId === attemptId)
                return;
            if (i.status !== 'active')
                throw new ReviewError('Review is not active.');
            this.db.prepare("UPDATE review_progress SET status='awaiting_evaluation',attempt_id=? WHERE item_id=?").run(attemptId, id);
            this.event(i, 'awaiting_evaluation', at, 'M4 attempt retained');
        });
    }
    attachOutcome(courseId: string, id: string, w: EvaluationWrite, at: string) {
        this.transaction(() => {
            const i = this.get(courseId, id);
            if (!i || i.attemptId !== w.evaluation.attemptId || w.evaluation.courseId !== courseId)
                throw new ReviewError('Review outcome scope mismatch.');
            const exists = this.db.prepare('SELECT 1 FROM review_outcomes WHERE item_id=? AND evaluation_id=?').get(id, w.evaluation.id);
            if (!exists) {
                this.db.prepare('INSERT INTO review_outcomes VALUES (?,?,?,?,?)').run(courseId, id, i.attemptId, w.evaluation.id, w.evidence?.id ?? null);
                this.event(i, 'outcome_linked', at, w.evaluation.status, w.evaluation.id, w.evidence?.id ?? null);
            }
            if (w.evaluation.status !== 'failed' && i.status === 'awaiting_evaluation')
                this.change(i, 'completed', at, 'M4 performance evaluated');
        });
    }
    private change(i: ReviewItem, status: ReviewStatus, at: string, reason: string) {
        this.db.prepare('UPDATE review_progress SET status=?,completed_at=? WHERE item_id=?').run(status, status === 'completed' ? at : null, i.id);
        this.event(i, status, at, reason);
    }
    transition(courseId: string, id: string, status: ReviewStatus, at: string, reason: string) {
        this.transaction(() => { const i = this.get(courseId, id); if (!i)
            throw new ReviewError('Review not found.'); this.change(i, status, at, reason); });
    }
    events(courseId: string, id: string): ReviewEvent[] { return this.db.prepare('SELECT * FROM review_events WHERE course_id=? AND item_id=? ORDER BY ordinal').all(courseId, id).map(r => ({ ordinal: Number(r.ordinal), kind: r.kind as ReviewEvent['kind'], at: String(r.at), reason: String(r.reason), evaluationId: r.evaluation_id === null ? null : String(r.evaluation_id), evidenceId: r.evidence_id === null ? null : String(r.evidence_id) })); }
}
