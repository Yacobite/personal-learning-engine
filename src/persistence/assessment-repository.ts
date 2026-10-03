import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { AssessmentError } from '../domain/assessment.ts';
import type { AssessmentTask, Attempt, EvaluationResult, EvaluationWrite, EvidenceEvent, EvidenceAudit } from '../domain/assessment.ts';
import type { AssessmentRepository } from '../ports/assessment-repository.ts';
type Row = Record<string, SQLOutputValue>;
export class SqliteAssessmentRepository implements AssessmentRepository {
    private readonly db: DatabaseSync;
    constructor(db: DatabaseSync) { this.db = db; }
    private transaction<T>(run: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try {
        const result = run();
        this.db.exec('COMMIT');
        return result;
    }
    catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
    } }
    saveTask(t: AssessmentTask): void {
        this.transaction(() => {
            // Deferred child-to-snapshot keys allow inserting the immutable parent last.
            // Once it exists, seal triggers forbid adding further child metadata.
            for (const concept of t.conceptIds)
                this.db.prepare('INSERT INTO task_concepts VALUES (?,?,?,?)').run(t.id, t.courseId, t.curriculumVersion, concept);
            for (const r of t.sourceRefs)
                this.db.prepare('INSERT INTO task_source_provenance VALUES (?,?,?,?,?)').run(t.id, t.courseId, r.sourceId, r.version, r.segmentId);
            for (const r of t.researchRefs)
                this.db.prepare('INSERT INTO task_research_provenance VALUES (?,?,?,?)').run(t.id, t.courseId, r.briefId, r.referenceId);
            this.db.prepare('INSERT INTO assessment_tasks(id,course_id,curriculum_version,type,representation,novelty,origin,prompt,dimensions_json,scoring_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                .run(t.id, t.courseId, t.curriculumVersion, t.type, t.representation, t.novelty, t.origin, t.prompt, JSON.stringify(t.intendedDimensions), JSON.stringify(t.scoring), t.createdAt);
        });
    }
    task(courseId: string, id: string): AssessmentTask | undefined {
        const r = this.db.prepare('SELECT * FROM assessment_tasks WHERE course_id=? AND id=?').get(courseId, id);
        if (!r)
            return;
        return { id, courseId, curriculumVersion: Number(r.curriculum_version), type: String(r.type) as AssessmentTask['type'], representation: String(r.representation) as AssessmentTask['representation'], novelty: String(r.novelty) as AssessmentTask['novelty'], origin: String(r.origin) as AssessmentTask['origin'], prompt: String(r.prompt), createdAt: String(r.created_at),
            scoring: JSON.parse(String(r.scoring_json)) as AssessmentTask['scoring'], intendedDimensions: JSON.parse(String(r.dimensions_json)) as AssessmentTask['intendedDimensions'],
            conceptIds: this.db.prepare('SELECT concept_id FROM task_concepts WHERE task_id=? ORDER BY concept_id').all(id).map((x) => String(x.concept_id)),
            sourceRefs: this.db.prepare('SELECT * FROM task_source_provenance WHERE task_id=? ORDER BY segment_id').all(id).map((x) => ({ sourceId: String(x.source_id), version: Number(x.source_version), segmentId: String(x.segment_id) })),
            researchRefs: this.db.prepare('SELECT * FROM task_research_provenance WHERE task_id=? ORDER BY reference_id').all(id).map((x) => ({ briefId: String(x.brief_id), referenceId: String(x.reference_id) })) };
    }
    private mapAttempt(r: Row): Attempt {
        const task = this.task(String(r.course_id), String(r.task_id))!;
        return { id: String(r.id), courseId: String(r.course_id), taskId: String(r.task_id), curriculumVersion: task.curriculumVersion, conceptIds: task.conceptIds, novelty: task.novelty, representation: task.representation, response: String(r.response), assistance: String(r.assistance) as Attempt['assistance'], hints: { count: Number(r.hint_count), highestLevel: String(r.highest_hint_level) as Attempt['assistance'], notes: r.hint_notes === null ? null : String(r.hint_notes) },
            ...(r.confidence === null ? {} : { confidence: Number(r.confidence) }), ...(r.latency_ms === null ? {} : { latencyMs: Number(r.latency_ms) }), ...(r.runtime_ref === null ? {} : { runtimeRef: String(r.runtime_ref) }), submittedAt: String(r.submitted_at), operationId: String(r.operation_id), requestHash: String(r.request_hash) };
    }
    attempt(courseId: string, id: string) { const row = this.db.prepare('SELECT * FROM assessment_attempts WHERE course_id=? AND id=?').get(courseId, id); return row ? this.mapAttempt(row) : undefined; }
    attemptOperation(courseId: string, key: string) { const row = this.db.prepare('SELECT * FROM assessment_attempts WHERE course_id=? AND operation_id=?').get(courseId, key); return row ? this.mapAttempt(row) : undefined; }
    saveAttempt(a: Attempt): Attempt {
        return this.transaction(() => {
            const existing = this.attemptOperation(a.courseId, a.operationId);
            if (existing) {
                if (existing.requestHash !== a.requestHash)
                    throw new AssessmentError('Attempt operation ID conflicts with its original payload.');
                return existing;
            }
            this.db.prepare('INSERT INTO assessment_attempts(id,course_id,task_id,response,assistance,hint_count,highest_hint_level,hint_notes,confidence,latency_ms,runtime_ref,submitted_at,operation_id,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                .run(a.id, a.courseId, a.taskId, a.response, a.assistance, a.hints.count, a.hints.highestLevel, a.hints.notes, a.confidence ?? null, a.latencyMs ?? null, a.runtimeRef ?? null, a.submittedAt, a.operationId, a.requestHash);
            return this.attempt(a.courseId, a.id)!;
        });
    }
    evaluation(courseId: string, id: string): EvaluationResult | undefined {
        const r = this.db.prepare('SELECT * FROM assessment_evaluations WHERE course_id=? AND id=?').get(courseId, id);
        if (!r)
            return;
        return { id, courseId, attemptId: String(r.attempt_id), status: String(r.status) as EvaluationResult['status'], correctness: r.correctness === null ? null : Number(r.correctness), rationale: String(r.rationale), createdAt: String(r.created_at), supersedes: r.supersedes === null ? null : String(r.supersedes), operationId: String(r.operation_id), requestHash: String(r.request_hash), evaluator: JSON.parse(String(r.evaluator_json)) as EvaluationResult['evaluator'],
            rubricScores: Object.fromEntries(this.db.prepare('SELECT key,score FROM evaluation_rubric_scores WHERE evaluation_id=? ORDER BY key').all(id).map((s) => [String(s.key), Number(s.score)])) };
    }
    private event(r: Row): EvidenceEvent { return { id: String(r.id), courseId: String(r.course_id), attemptId: String(r.attempt_id), evaluationId: String(r.evaluation_id), createdAt: String(r.created_at) }; }
    evaluationOperation(courseId: string, key: string): EvaluationWrite | undefined {
        const row = this.db.prepare('SELECT id FROM assessment_evaluations WHERE course_id=? AND operation_id=?').get(courseId, key);
        if (!row)
            return;
        const event = this.db.prepare('SELECT * FROM evidence_events WHERE evaluation_id=?').get(row.id!);
        return { evaluation: this.evaluation(courseId, String(row.id))!, evidence: event ? this.event(event) : null };
    }
    saveEvaluation(w: EvaluationWrite): EvaluationWrite {
        return this.transaction(() => {
            const e = w.evaluation;
            const existing = this.evaluationOperation(e.courseId, e.operationId);
            if (existing) {
                if (existing.evaluation.requestHash !== e.requestHash)
                    throw new AssessmentError('Evaluation operation ID conflicts with its original payload.');
                return existing;
            }
            if ((e.status === 'failed') !== (w.evidence === null))
                throw new AssessmentError('Valid evaluation/evidence must be written together; failed evaluations have no event.');
            if (w.evidence && (w.evidence.courseId !== e.courseId || w.evidence.attemptId !== e.attemptId || w.evidence.evaluationId !== e.id))
                throw new AssessmentError('Evidence/evaluation identity mismatch.');
            for (const [key, score] of Object.entries(e.rubricScores))
                this.db.prepare('INSERT INTO evaluation_rubric_scores VALUES (?,?,?)').run(e.id, key, score);
            this.db.prepare('INSERT INTO assessment_evaluations(id,course_id,attempt_id,status,correctness,evaluator_json,rationale,created_at,supersedes,operation_id,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                .run(e.id, e.courseId, e.attemptId, e.status, e.correctness, JSON.stringify(e.evaluator), e.rationale, e.createdAt, e.supersedes, e.operationId, e.requestHash);
            if (w.evidence) {
                const v = w.evidence;
                this.db.prepare('INSERT INTO evidence_events VALUES (?,?,?,?,?)').run(v.id, v.courseId, v.attemptId, v.evaluationId, v.createdAt);
            }
            return this.evaluationOperation(e.courseId, e.operationId)!;
        });
    }
    evaluations(courseId: string, attemptId: string) { return this.db.prepare('SELECT id FROM assessment_evaluations WHERE course_id=? AND attempt_id=? ORDER BY created_at,id').all(courseId, attemptId).map((r) => this.evaluation(courseId, String(r.id))!); }
    evidence(courseId: string, id: string): EvidenceAudit | undefined { const r = this.db.prepare('SELECT * FROM evidence_events WHERE course_id=? AND id=?').get(courseId, id); if (!r)
        return; const event = this.event(r); const attempt = this.attempt(courseId, event.attemptId)!; return { event, attempt, task: this.task(courseId, attempt.taskId)!, evaluation: this.evaluation(courseId, event.evaluationId)! }; }
    recent(courseId: string, limit: number, conceptId?: string) {
        return this.db.prepare(`SELECT e.id FROM evidence_events e JOIN assessment_attempts a ON a.id=e.attempt_id
    WHERE e.course_id=? AND (? IS NULL OR EXISTS (SELECT 1 FROM task_concepts c WHERE c.task_id=a.task_id AND c.concept_id=?)) ORDER BY e.created_at DESC,e.id DESC LIMIT ?`).all(courseId, conceptId ?? null, conceptId ?? null, limit).map((r) => this.evidence(courseId, String(r.id))!);
    }
}
