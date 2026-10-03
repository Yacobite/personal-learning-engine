import { AssessmentError, isAssessmentId } from '../domain/assessment.ts';
import type { EvaluatorIdentity, EvaluationWrite, EvaluationProposal } from '../domain/assessment.ts';
import { canonical, operationId, validateEvaluation, validateIdentity } from '../domain/assessment-validation.ts';
import type { AssessmentRepository } from '../ports/assessment-repository.ts';
import type { AnswerEvaluator } from '../ports/answer-evaluator.ts';
import type { AssessmentService } from './assessment-service.ts';
export class EvaluationService {
    private readonly assessments: Pick<AssessmentService, 'attempt' | 'task'>;
    private readonly repo: AssessmentRepository;
    private readonly id: (prefix: 'evaluation' | 'evidence') => string;
    private readonly hash: (value: string) => string;
    private readonly clock: () => Date;
    constructor(assessments: Pick<AssessmentService, 'attempt' | 'task'>, repo: AssessmentRepository, id: (prefix: 'evaluation' | 'evidence') => string, hash: (value: string) => string, clock: () => Date) {
        this.assessments = assessments;
        this.repo = repo;
        this.id = id;
        this.hash = hash;
        this.clock = clock;
    }
    async evaluate(courseId: string, attemptId: string, key: string, evaluator: AnswerEvaluator, supersedes: string | null = null): Promise<EvaluationWrite> {
        const attempt = this.assessments.attempt(courseId, attemptId);
        const task = this.assessments.task(courseId, attempt.taskId);
        const identity = validateIdentity(evaluator.identity);
        const requestHash = this.fingerprint(key, { mode: 'evaluate', attemptId, identity, supersedes });
        const existing = this.existing(courseId, key, requestHash);
        if (existing)
            return existing;
        this.lineage(courseId, attemptId, supersedes);
        let proposal: unknown;
        try {
            proposal = await evaluator.evaluate({ task: structuredClone(task), attempt: structuredClone(attempt) });
        }
        catch {
            proposal = { status: 'failed', correctness: null, rubricScores: {}, rationale: 'Evaluator invocation failed; the submitted attempt remains available for a later evaluation.' };
        }
        // Invalid proposals are rejected; invocation failures are explicit non-scored records.
        return this.write(courseId, attemptId, key, requestHash, identity, validateEvaluation(proposal, task.scoring), supersedes);
    }
    record(courseId: string, attemptId: string, key: string, identityValue: unknown, proposalValue: unknown, supersedes: string | null = null): EvaluationWrite {
        const attempt = this.assessments.attempt(courseId, attemptId);
        const task = this.assessments.task(courseId, attempt.taskId);
        const identity = validateIdentity(identityValue);
        const proposal = validateEvaluation(proposalValue, task.scoring);
        const requestHash = this.fingerprint(key, { mode: 'record', attemptId, identity, proposal, supersedes });
        const existing = this.existing(courseId, key, requestHash);
        if (existing)
            return existing;
        this.lineage(courseId, attemptId, supersedes);
        return this.write(courseId, attemptId, key, requestHash, identity, proposal, supersedes);
    }
    list(courseId: string, attemptId: string) { this.assessments.attempt(courseId, attemptId); return this.repo.evaluations(courseId, attemptId); }
    heads(courseId: string, attemptId: string) { const all = this.list(courseId, attemptId); const parents = new Set(all.map((e) => e.supersedes)); return all.filter((e) => !parents.has(e.id)); }
    private fingerprint(key: string, request: unknown): string {
        operationId(key);
        const hash = this.hash(canonical(request));
        if (!/^[a-f0-9]{64}$/.test(hash))
            throw new AssessmentError('Hasher must return SHA-256.');
        return hash;
    }
    private existing(courseId: string, key: string, hash: string) {
        const existing = this.repo.evaluationOperation(courseId, key);
        if (existing && existing.evaluation.requestHash !== hash)
            throw new AssessmentError('Evaluation operation ID conflicts with its original payload.');
        return existing;
    }
    private lineage(courseId: string, attemptId: string, parent: string | null): void {
        if (parent === null)
            return;
        if (!isAssessmentId(parent, 'evaluation') || this.repo.evaluation(courseId, parent)?.attemptId !== attemptId)
            throw new AssessmentError('Superseded evaluation must exist for this same attempt.');
    }
    private write(courseId: string, attemptId: string, key: string, requestHash: string, evaluator: EvaluatorIdentity, proposal: EvaluationProposal, supersedes: string | null): EvaluationWrite {
        const id = this.id('evaluation');
        if (!isAssessmentId(id, 'evaluation') || id === supersedes)
            throw new AssessmentError('Invalid generated evaluation ID or self-supersession.');
        const createdAt = this.clock().toISOString();
        const evaluation = { ...proposal, id, courseId, attemptId, evaluator, createdAt, supersedes, operationId: key, requestHash };
        let evidence: EvaluationWrite['evidence'] = null;
        if (proposal.status !== 'failed') {
            const evidenceId = this.id('evidence');
            if (!isAssessmentId(evidenceId, 'evidence'))
                throw new AssessmentError('Invalid generated evidence ID.');
            evidence = { id: evidenceId, courseId, attemptId, evaluationId: id, createdAt };
        }
        return this.repo.saveEvaluation({ evaluation, evidence });
    }
}
