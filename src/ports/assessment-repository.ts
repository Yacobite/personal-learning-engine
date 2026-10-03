import type { AssessmentTask, Attempt, EvaluationResult, EvaluationWrite, EvidenceAudit } from '../domain/assessment.ts';
export interface AssessmentRepository {
    saveTask(task: AssessmentTask): void;
    task(courseId: string, id: string): AssessmentTask | undefined;
    saveAttempt(attempt: Attempt): Attempt;
    attempt(courseId: string, id: string): Attempt | undefined;
    attemptOperation(courseId: string, operationId: string): Attempt | undefined;
    saveEvaluation(write: EvaluationWrite): EvaluationWrite;
    evaluation(courseId: string, id: string): EvaluationResult | undefined;
    evaluationOperation(courseId: string, operationId: string): EvaluationWrite | undefined;
    evaluations(courseId: string, attemptId: string): EvaluationResult[];
    evidence(courseId: string, id: string): EvidenceAudit | undefined;
    recent(courseId: string, limit: number, conceptId?: string): EvidenceAudit[];
}
