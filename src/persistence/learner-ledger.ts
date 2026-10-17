import type { DatabaseSync } from 'node:sqlite';
import type { LearnerLedger } from '../ports/learner-ledger.ts';
import type { PerformanceRecord } from '../domain/learner-state.ts';
/** A read adapter over canonical M4 tables. No answers, keys, rationales or source text. */
export class SqliteLearnerLedger implements LearnerLedger {
    private readonly db: DatabaseSync;
    constructor(db: DatabaseSync) { this.db = db; }
    read(courseId: string, asOf: string): PerformanceRecord[] {
        const owned = !this.db.isTransaction;
        if (owned)
            this.db.exec('BEGIN');
        try {
            const records = this.db.prepare(`SELECT a.id,a.task_id,a.submitted_at,a.assistance,a.hint_count,a.highest_hint_level,a.confidence,
        t.curriculum_version,t.type,t.dimensions_json,t.representation,t.novelty,t.prompt
        FROM assessment_attempts a JOIN assessment_tasks t ON t.course_id=a.course_id AND t.id=a.task_id
        WHERE a.course_id=? AND a.submitted_at<=? ORDER BY a.submitted_at,a.id`).all(courseId, asOf).map(r => ({
                task: { id: String(r.task_id), curriculumVersion: Number(r.curriculum_version), type: r.type as PerformanceRecord['task']['type'],
                    intendedDimensions: JSON.parse(String(r.dimensions_json)), representation: r.representation as PerformanceRecord['task']['representation'],
                    novelty: r.novelty as PerformanceRecord['task']['novelty'], prompt: String(r.prompt),
                    conceptIds: this.db.prepare('SELECT concept_id FROM task_concepts WHERE task_id=? ORDER BY concept_id').all(String(r.task_id)).map(c => String(c.concept_id)) },
                attempt: { id: String(r.id), submittedAt: String(r.submitted_at), assistance: r.assistance as PerformanceRecord['attempt']['assistance'],
                    hints: { count: Number(r.hint_count), highestLevel: r.highest_hint_level as PerformanceRecord['attempt']['assistance'], notes: null },
                    ...(r.confidence === null ? {} : { confidence: Number(r.confidence) }) },
                evaluations: this.db.prepare(`SELECT e.id,e.supersedes,e.status,e.correctness,e.created_at,v.id AS evidence_id FROM assessment_evaluations e
          LEFT JOIN evidence_events v ON v.course_id=e.course_id AND v.evaluation_id=e.id AND v.attempt_id=e.attempt_id
          WHERE e.course_id=? AND e.attempt_id=? AND e.created_at<=? ORDER BY e.created_at,e.id`).all(courseId, String(r.id), asOf).map(e => ({
                    id: String(e.id), supersedes: e.supersedes === null ? null : String(e.supersedes), status: e.status as PerformanceRecord['evaluations'][number]['status'],
                    correctness: e.correctness === null ? null : Number(e.correctness), createdAt: String(e.created_at), evidenceId: e.evidence_id === null ? null : String(e.evidence_id)
                }))
            }));
            if (owned)
                this.db.exec('COMMIT');
            return records;
        }
        catch (e) {
            if (owned)
                this.db.exec('ROLLBACK');
            throw e;
        }
    }
}
