import { canonical, object } from '../domain/assessment-validation.ts';
import { reviewCandidates } from '../domain/review-schedule-policy.ts';
import { reviewQueue } from '../domain/review-queue-policy.ts';
import { reviewId, reviewLimit, reviewOutcome, temporalStatus, ReviewError } from '../domain/review.ts';
import type { ReviewItem } from '../domain/review.ts';
import type { LearnerStateRevision } from '../domain/learner-state.ts';
import type { ReviewRepository } from '../ports/review-repository.ts';
import type { ReviewTaskGenerator, ReviewTaskContext } from '../ports/review-generator.ts';
import type { AnswerEvaluator } from '../ports/answer-evaluator.ts';
import type { AssessmentRepository } from '../ports/assessment-repository.ts';
import type { DiagnosticLedger } from '../ports/diagnostic-ledger.ts';
import type { GraphService } from './graph-service.ts';
import type { AssessmentService } from './assessment-service.ts';
import type { EvaluationService } from './evaluation-service.ts';
import type { LearnerStateService } from './learner-state-service.ts';
import type { TeachingContextBuilder } from './teaching-context.ts';
import { reviewTask } from './review-content.ts';
export class ReviewService {
    private readonly repo: ReviewRepository;
    private readonly ledger: Pick<AssessmentRepository, 'attemptOperation'> & Pick<DiagnosticLedger, 'evidenceForAttempt'>;
    private readonly graphs: Pick<GraphService, 'get'>;
    private readonly assessments: Pick<AssessmentService, 'task' | 'attempt' | 'submit' | 'createTask'>;
    private readonly evaluations: Pick<EvaluationService, 'heads' | 'evaluate'>;
    private readonly state: Pick<LearnerStateService, 'refresh' | 'competenceTimeline'>;
    private readonly context: Pick<TeachingContextBuilder, 'tryBuild'>;
    private readonly id: () => string;
    private readonly hash: (s: string) => string;
    private readonly clock: () => Date;
    constructor(repo: ReviewRepository, ledger: ReviewService['ledger'], graphs: ReviewService['graphs'], assessments: ReviewService['assessments'], evaluations: ReviewService['evaluations'], state: ReviewService['state'], context: ReviewService['context'], id: () => string, hash: (s: string) => string, clock: () => Date) {
        this.repo = repo;
        this.ledger = ledger;
        this.graphs = graphs;
        this.assessments = assessments;
        this.evaluations = evaluations;
        this.state = state;
        this.context = context;
        this.id = id;
        this.hash = hash;
        this.clock = clock;
    }
    private now() { return this.clock().toISOString(); }
    private key(id: string) { return 'review:' + id; }
    get(courseId: string, id: string): ReviewItem {
        if (!reviewId(id))
            throw new ReviewError('Invalid review ID.');
        const i = this.repo.get(courseId, id);
        if (!i)
            throw new ReviewError('Review not found in this course.');
        return i;
    }
    /** Repair M8 links from M4 operation IDs before requesting another performance. */
    private recover(courseId: string) {
        for (let i of this.repo.list(courseId).filter(i => ['active', 'awaiting_evaluation', 'completed'].includes(i.status))) {
            const attempt = this.ledger.attemptOperation(courseId, this.key(i.id));
            if (!attempt)
                continue;
            this.repo.attachAttempt(courseId, i.id, attempt.id, this.now());
            i = this.get(courseId, i.id);
            const events = this.ledger.evidenceForAttempt(courseId, attempt.id);
            for (const evaluation of this.evaluations.heads(courseId, attempt.id))
                this.repo.attachOutcome(courseId, i.id, { evaluation, evidence: events.find(e => e.evaluationId === evaluation.id) ?? null }, this.now());
        }
    }
    refresh(courseId: string, version?: number): LearnerStateRevision {
        this.recover(courseId);
        // A failed refresh stops here: M4 outcomes survive, no stale future schedule is advanced.
        const state = this.state.refresh(courseId, version), at = this.now();
        const timelines = Object.fromEntries(state.readiness.filter(r => r.stage === 'durable_mastery').map(r => [r.conceptId, this.state.competenceTimeline(courseId, r.conceptId, state.id)]));
        const history = this.repo.list(courseId);
        const fingerprint = this.hash(canonical({ state: state.fingerprint, version: state.curriculumVersion, history: history.map(i => [i.id, i.status, i.attemptId]) }));
        this.repo.reconcile(courseId, state.id, at, items => reviewCandidates(state, items, timelines, this.hash).map(c => ({ ...c, id: this.id(), createdAt: at, status: 'scheduled', taskId: null, attemptId: null, completedAt: null })), fingerprint);
        return state;
    }
    queue(courseId: string, limit = 10) {
        reviewLimit(limit);
        const state = this.refresh(courseId), now = this.now();
        const items = this.repo.list(courseId).filter(i => i.curriculumVersion === state.curriculumVersion);
        const upcoming = items.filter(i => i.status === 'scheduled' && temporalStatus(i, now) === 'upcoming').sort((a, b) => a.earliestAt.localeCompare(b.earliestAt) || a.id.localeCompare(b.id)).slice(0, limit);
        return { stateRevisionId: state.id, curriculumVersion: state.curriculumVersion, now, active: this.repo.list(courseId).find(i => ['active', 'awaiting_evaluation'].includes(i.status)) ?? null,
            due: reviewQueue(items, now, limit).map(i => ({ ...i, temporalStatus: temporalStatus(i, now) })), upcoming,
            repair: state.gaps.filter(g => ['OPEN', 'REPAIR_IN_PROGRESS'].includes(g.status)).slice(0, limit).map(g => ({ gapId: g.id, conceptId: g.conceptId, dimension: g.dimension, message: 'requires repair before verification' })) };
    }
    async next(courseId: string, generator: ReviewTaskGenerator) {
        const state = this.refresh(courseId), now = this.now();
        const active = this.repo.list(courseId).find(i => ['active', 'awaiting_evaluation'].includes(i.status));
        if (active)
            return { item: active, reason: 'resume' };
        const graph = this.graphs.get(courseId);
        const candidates = reviewQueue(this.repo.list(courseId).filter(i => i.curriculumVersion === graph.version), now, 50);
        for (const i of candidates) {
            const grounding = this.context.tryBuild(graph, i.conceptId, 1);
            if (!grounding) {
                this.repo.transition(courseId, i.id, 'superseded', now, 'no_evaluable_review_task');
                continue;
            }
            const previousPromptHashes = [...new Set([
                ...state.observations.filter(o => o.conceptIds.includes(i.conceptId)).map(o => o.promptHash),
                ...this.repo.list(courseId).filter(h => h.conceptId === i.conceptId && h.taskId).map(h => this.hash(this.assessments.task(courseId, h.taskId!).prompt.trim().replace(/\s+/g, ' ')))
            ])];
            const context: ReviewTaskContext = { grounding: { ...grounding, type: i.type, representation: i.representation, novelty: i.novelty }, item: { dimension: i.dimension, type: i.type, representation: i.representation, novelty: i.novelty }, previousPromptHashes };
            // Transient exceptions propagate without blocking the concept or persisting a task.
            const proposal = await generator.propose(structuredClone({ ...context, previousPromptHashes: context.previousPromptHashes.slice(-100) }));
            const taskInput = reviewTask(context, proposal, this.hash);
            const latest = this.refresh(courseId);
            if (latest.id !== state.id || this.graphs.get(courseId).version !== graph.version)
                throw new ReviewError('State changed during review generation; retry next.');
            const existing = this.repo.list(courseId).find(i => ['active', 'awaiting_evaluation'].includes(i.status));
            if (existing)
                return { item: existing, reason: 'resume' };
            this.assessments.createTask(courseId, taskInput, task => this.repo.linkTask(courseId, i.id, task.id, this.now(), state.id));
            return { item: this.get(courseId, i.id), reason: 'selected' };
        }
        return { item: null, reason: candidates.length ? 'no_evaluable_review_task' : 'nothing_due' };
    }
    async answer(courseId: string, id: string, value: unknown, evaluator: AnswerEvaluator) {
        const i = this.get(courseId, id);
        if (!i.taskId || !['active', 'awaiting_evaluation', 'completed'].includes(i.status))
            throw new ReviewError('Review has no active performance task.');
        if (this.now() < i.earliestAt)
            throw new ReviewError('Review is not yet eligible.');
        const input = object(value, ['response'], ['assistance', 'hints', 'confidence', 'latencyMs']);
        const assistance = input.assistance ?? 'none';
        const attempt = this.assessments.submit(courseId, this.key(id), { ...input, taskId: i.taskId, assistance, hints: input.hints ?? { count: 0, highestLevel: 'none', notes: null } });
        this.repo.attachAttempt(courseId, id, attempt.id, this.now());
        await this.evaluations.evaluate(courseId, attempt.id, this.key(id) + ':evaluation', evaluator);
        this.refresh(courseId);
        return this.show(courseId, id);
    }
    async retryEvaluation(courseId: string, id: string, evaluator: AnswerEvaluator) {
        this.recover(courseId);
        const i = this.get(courseId, id);
        if (i.status !== 'awaiting_evaluation' || !i.attemptId)
            throw new ReviewError('Review is not awaiting evaluation.');
        const heads = this.evaluations.heads(courseId, i.attemptId);
        if (heads.length > 1)
            throw new ReviewError('Resolve ambiguous M4 evaluation heads before retrying.');
        await this.evaluations.evaluate(courseId, i.attemptId, this.key(id) + ':retry:' + (heads[0]?.id ?? 'missing'), evaluator, heads[0]?.id ?? null);
        this.refresh(courseId);
        return this.show(courseId, id);
    }
    show(courseId: string, id: string) {
        const i = this.get(courseId, id), revision = this.state.refresh(courseId, i.curriculumVersion);
        const o = revision.observations.find(o => o.attemptId === i.attemptId);
        return { item: i, performedAt: o?.at ?? null, outcome: o ? reviewOutcome(i, o) : null, terminalEvaluationIds: o?.heads.map(h => h.id) ?? [], events: this.repo.events(courseId, id) };
    }
    history(courseId: string, limit = 10) {
        reviewLimit(limit);
        this.refresh(courseId);
        return this.repo.list(courseId).slice(-limit).reverse().map(i => this.show(courseId, i.id));
    }
}
