import { episode, assistanceFor, teachingId, teachingPolicy, TeachingError } from '../domain/teaching.ts';
import type { TeachingSession, TeachingMove, TeachingSummary, TeachingState, Scaffold } from '../domain/teaching.ts';
import { advance } from '../domain/teaching-policy.ts';
import { object } from '../domain/assessment-validation.ts';
import type { TeachingRepository } from '../ports/teaching-repository.ts';
import type { TeachingContentGenerator, TeachingContext } from '../ports/teaching-generator.ts';
import type { DiagnosticRepository } from '../ports/diagnostic-repository.ts';
import type { DiagnosticLedger } from '../ports/diagnostic-ledger.ts';
import type { AnswerEvaluator } from '../ports/answer-evaluator.ts';
import type { GraphService } from './graph-service.ts';
import type { AssessmentService } from './assessment-service.ts';
import type { EvaluationService } from './evaluation-service.ts';
import { DiagnosticContextBuilder, publicDiagnosticTask } from './diagnostic-context.ts';
import { teachingContent } from './teaching-content.ts';
export class TeachingService {
    private readonly repo: TeachingRepository;
    private readonly diagnostics: DiagnosticRepository;
    private readonly ledger: DiagnosticLedger;
    private readonly graphs: Pick<GraphService, 'get'>;
    private readonly assessments: AssessmentService;
    private readonly evaluations: EvaluationService;
    private readonly grounding: DiagnosticContextBuilder;
    private readonly id: (prefix: 'teaching' | 'move') => string;
    private readonly clock: () => Date;
    constructor(repo: TeachingRepository, diagnostics: DiagnosticRepository, ledger: DiagnosticLedger, graphs: Pick<GraphService, 'get'>, assessments: AssessmentService, evaluations: EvaluationService, grounding: DiagnosticContextBuilder, id: (prefix: 'teaching' | 'move') => string, clock: () => Date) { this.repo = repo; this.diagnostics = diagnostics; this.ledger = ledger; this.graphs = graphs; this.assessments = assessments; this.evaluations = evaluations; this.grounding = grounding; this.id = id; this.clock = clock; }
    private now() { return this.clock().toISOString(); }
    private newId(prefix: 'teaching' | 'move') { const id = this.id(prefix); if (!teachingId(id, prefix))
        throw new TeachingError('Invalid teaching identity.'); return id; }
    start(courseId: string, options: {
        conceptId?: string;
        budget?: number;
    } = {}) {
        object(options, [], ['conceptId', 'budget']);
        const budget = options.budget ?? 24;
        if (!Number.isSafeInteger(budget) || budget < 1 || budget > 80)
            throw new TeachingError('Move budget must be 1–80.');
        const existing = this.repo.current(courseId);
        if (existing) {
            if (existing.budget !== budget || (options.conceptId && existing.recommendations[0] !== options.conceptId))
                throw new TeachingError('Incompatible active teaching session; resume or abandon it.');
            return existing;
        }
        const graph = this.graphs.get(courseId);
        if (options.conceptId && !graph.nodes.some(n => n.conceptId === options.conceptId))
            throw new TeachingError('Concept does not belong to this curriculum.');
        const diagnostic = options.conceptId ? undefined : this.diagnostics.history(courseId).filter(s => s.status === 'completed' && s.curriculumVersion === graph.version && s.summary?.frontier.length).sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '') || b.id.localeCompare(a.id))[0];
        const roots = graph.nodes.filter(n => !graph.edges.some(e => e.type === 'prerequisite_of' && e.to === n.conceptId)).map(n => n.conceptId).sort();
        const recommended = options.conceptId ? [options.conceptId] : diagnostic?.summary?.frontier.map(f => f.conceptId) ?? roots;
        const eligible = recommended.filter(id => this.grounding.tryBuild(graph, id, 1));
        const targets = diagnostic || options.conceptId ? eligible : eligible.slice(0, 1);
        if (!targets.length)
            throw new TeachingError('No grounded starting target is available.');
        return this.repo.start({ id: this.newId('teaching'), courseId, curriculumVersion: graph.version, policy: teachingPolicy, diagnosticId: diagnostic?.id ?? null, recommendations: targets, budget, status: 'in_progress', startedAt: this.now(), endedAt: null, summary: null, revision: 0, state: { episode: episode(targets[0]!), queue: targets.slice(1), stack: [], outcomes: [] } });
    }
    current(courseId: string) { return this.repo.current(courseId); }
    history(courseId: string) { return this.repo.history(courseId); }
    get(courseId: string, id: string) { if (!teachingId(id, 'teaching'))
        throw new TeachingError('Invalid teaching session ID.'); const s = this.repo.get(courseId, id); if (!s)
        throw new TeachingError('Teaching session not found in this course.'); return s; }
    moves(courseId: string, id: string) { this.get(courseId, id); return this.repo.moves(courseId, id); }
    private active(courseId: string) { const s = this.current(courseId); if (!s)
        throw new TeachingError('Start teaching first.'); this.recover(s); return s; }
    private recover(s: TeachingSession) { for (const m of this.repo.moves(s.courseId, s.id).filter(m => m.status === 'outstanding')) {
        const a = this.ledger.attemptOperation(s.courseId, `teaching:${m.id}:submit`);
        if (a)
            this.repo.attachAttempt(s.courseId, m.id, a.id);
    } }
    private observation(courseId: string, m: TeachingMove) { if (!m.attemptId)
        throw new TeachingError('Move has no learner attempt.'); const attempt = this.assessments.attempt(courseId, m.attemptId); return { task: this.assessments.task(courseId, attempt.taskId), attempt, heads: this.evaluations.heads(courseId, attempt.id) }; }
    private finish(s: TeachingSession, state: TeachingState, reason: TeachingSummary['stopReason']) {
        state = structuredClone(state);
        const moves = this.repo.moves(s.courseId, s.id);
        state.outcomes = state.outcomes.map(outcome => {
            if (!outcome.outcome.startsWith('completed_')) return outcome;
            const check = moves.filter(m => m.conceptId === outcome.conceptId && m.type === 'near_transfer' && m.attemptId).at(-1);
            const observation = check ? this.observation(s.courseId, check) : null;
            const independentSuccess = observation && observation.attempt.assistance === 'none' && observation.attempt.hints.count === 0 && observation.heads.length === 1 && observation.heads[0]!.status === 'scored' && observation.heads[0]!.correctness === 1;
            return independentSuccess ? outcome : { ...outcome, outcome: 'needs_more_instruction' as const };
        });
        const summary: TeachingSummary = { asOf: this.now(), curriculumVersion: s.curriculumVersion, diagnosticId: s.diagnosticId, policy: s.policy, stopReason: reason, outcomes: state.outcomes, moves: this.repo.moves(s.courseId, s.id).map(m => { const heads = m.attemptId ? this.evaluations.heads(s.courseId, m.attemptId) : []; return { id: m.id, conceptId: m.conceptId, type: m.type, reason: m.reason, level: this.repo.support(s.courseId, m.id).level, taskId: m.taskId, attemptId: m.attemptId, evaluationIds: heads.map(h => h.id), evidenceIds: m.attemptId ? this.ledger.evidenceForAttempt(s.courseId, m.attemptId).filter(e => heads.some(h => h.id === e.evaluationId)).map(e => e.id) : [], sourceRefs: m.content.sourceRefs, researchRefs: m.content.researchRefs }; }), nextRecommendations: [...new Set([...(state.episode ? [state.episode.conceptId] : []), ...state.queue, ...state.outcomes.filter(o => o.outcome === 'needs_more_instruction' || o.outcome === 'deferred').map(o => o.conceptId)])], warning: 'Session-local instruction only. Teach-back is captured without semantic judgment. Immediate performance is not durable mastery; no gaps or reviews are created.' };
        return this.repo.finish(s.courseId, s.id, summary, state);
    }
    async next(courseId: string, generator: TeachingContentGenerator) {
        const s = this.active(courseId);
        const moves = this.repo.moves(courseId, s.id);
        const pending = moves.find(m => m.status === 'outstanding' || m.status === 'answered');
        if (pending)
            return { session: s, move: pending };
        const graph = this.graphs.get(courseId, s.curriculumVersion);
        let state = s.state;
        let reason = 'question_first_activation';
        const last = moves.filter(m => m.reason !== 'learner_requested_hint').at(-1);
        if (last) {
            const decision = advance(graph, state, last, last.taskId ? this.observation(courseId, last) : undefined);
            state = decision.state;
            reason = decision.reason;
        }
        if (!state.episode)
            return { session: this.finish(s, state, 'instructional_goal_reached'), move: null };
        if (moves.length >= s.budget)
            return { session: this.finish(s, state, 'move_budget_exhausted'), move: null };
        return this.generate(s, state, reason, generator, null);
    }
    private async generate(s: TeachingSession, state: TeachingState, reason: string, generator: TeachingContentGenerator, hintFor: TeachingMove | null) {
        const e = state.episode!;
        const moves = this.repo.moves(s.courseId, s.id);
        const graph = this.graphs.get(s.courseId, s.curriculumVersion);
        const grounding = this.grounding.tryBuild(graph, e.conceptId, moves.length + 1);
        if (!grounding)
            return { session: this.finish(s, state, 'no_grounded_content'), move: null };
        grounding.representation = e.phase === 'near_transfer' ? 'mixed' : 'text';
        grounding.type = e.phase === 'teach_back' ? 'self_explanation' : e.phase === 'near_transfer' ? 'near_transfer' : 'cued_recall';
        grounding.novelty = e.phase === 'near_transfer' ? 'near_transfer' : 'isomorphic';
        const relevant = hintFor ?? moves.filter(m => m.conceptId === e.conceptId && m.taskId).at(-1);
        const reviewed = relevant?.attemptId ? this.observation(s.courseId, relevant) : null;
        const context: TeachingContext = { grounding, moveType: hintFor ? 'scaffold' : e.phase, level: e.level, reason, previousPrompts: moves.filter(m => m.taskId).map(m => this.assessments.task(s.courseId, m.taskId!).prompt), pendingTask: relevant?.taskId ? publicDiagnosticTask(this.assessments.task(s.courseId, relevant.taskId)) : null, feedback: reviewed ? { response: reviewed.attempt.response.slice(0, 4000), result: reviewed.heads.length === 1 ? String(reviewed.heads[0]!.correctness ?? reviewed.heads[0]!.status) : 'uncertain' } : null, ...(e.level === 4 && relevant?.taskId ? { workedAnswer: this.assessments.task(s.courseId, relevant.taskId).scoring } : {}) };
        const modelContext = structuredClone(context);
        modelContext.previousPrompts = modelContext.previousPrompts.slice(-6);
        const terminalIds = () => JSON.stringify(moves.filter(m => m.attemptId).map(m => [m.attemptId, this.evaluations.heads(s.courseId, m.attemptId!).map(h => h.id).sort()]));
        const beforeEvaluation = terminalIds();
        const proposal = teachingContent(context, await generator.propose(modelContext));
        const fresh = this.get(s.courseId, s.id);
        if (fresh.status !== 'in_progress' || fresh.revision !== s.revision)
            throw new TeachingError('Teaching advanced during generation; retry.');
        if (terminalIds() !== beforeEvaluation)
            throw new TeachingError('M4 evaluations changed during generation; retry next.');
        const m: TeachingMove = { id: this.newId('move'), courseId: s.courseId, sessionId: s.id, curriculumVersion: s.curriculumVersion, sequence: moves.length + 1, conceptId: e.conceptId, type: context.moveType, reason, level: e.level, content: proposal.content, taskId: null, attemptId: null, status: proposal.task ? 'outstanding' : 'content', createdAt: this.now(), outcomes: [] };
        if (proposal.task)
            this.assessments.createTask(s.courseId, proposal.task, t => { m.taskId = t.id; this.repo.insert(m, s.revision, state, null); });
        else
            this.repo.content(m, s.revision, state, hintFor?.id ?? null);
        return { session: this.get(s.courseId, s.id), move: this.repo.moves(s.courseId, s.id).find(v => v.id === m.id)! };
    }
    async hint(courseId: string, generator: TeachingContentGenerator) { const s = this.active(courseId); const moves = this.repo.moves(courseId, s.id); const pending = moves.find(m => m.status === 'outstanding'); if (!pending)
        throw new TeachingError('A hint requires an unanswered task.'); if (moves.length >= s.budget)
        throw new TeachingError('Move budget exhausted; answer or abandon.'); const support = this.repo.support(courseId, pending.id); if (support.level >= 4)
        return { session: s, move: moves.filter(m => m.type === 'scaffold').at(-1) ?? pending }; const state = structuredClone(s.state); state.episode!.level = (support.level + 1) as Scaffold; state.episode!.supported = true; return this.generate(s, state, 'learner_requested_hint', generator, pending); }
    private move(s: TeachingSession, id: string) { if (!teachingId(id, 'move'))
        throw new TeachingError('Invalid move ID.'); const m = this.repo.moves(s.courseId, s.id).find(m => m.id === id); if (!m || !m.taskId)
        throw new TeachingError('Interactive move not found.'); return m; }
    async answer(courseId: string, id: string, value: unknown, evaluator: AnswerEvaluator) {
        const s = this.active(courseId);
        const m = this.move(s, id);
        const p = object(value, ['response'], ['aiPerformed', 'confidence', 'latencyMs']);
        if (p.aiPerformed !== undefined && typeof p.aiPerformed !== 'boolean')
            throw new TeachingError('aiPerformed must be boolean.');
        const help = this.repo.support(courseId, id);
        const assistance = p.aiPerformed === true ? 'ai_performed' : assistanceFor(help.level);
        const a = this.assessments.submit(courseId, `teaching:${id}:submit`, { taskId: m.taskId!, response: p.response as string, assistance, hints: { count: help.count, highestLevel: help.count ? assistanceFor(help.level) : 'none', notes: help.count ? 'Recorded teaching support.' : null }, ...(p.confidence !== undefined ? { confidence: p.confidence as number } : {}), ...(p.latencyMs !== undefined ? { latencyMs: p.latencyMs as number } : {}) });
        this.repo.attachAttempt(courseId, id, a.id);
        if (m.status !== 'resolved') {
            const w = await this.evaluations.evaluate(courseId, a.id, `teaching:${id}:evaluate`, evaluator);
            this.repo.attachOutcome(courseId, id, w);
        }
        return this.move(s, id);
    }
    async retry(courseId: string, id: string, evaluator: AnswerEvaluator) {
        const s = this.active(courseId);
        const m = this.move(s, id);
        if (m.status === 'resolved')
            return m;
        if (!m.attemptId)
            throw new TeachingError('Submit before retry.');
        const heads = this.evaluations.heads(courseId, m.attemptId);
        if (heads.length > 1)
            throw new TeachingError('Conflicting heads require explicit M4 correction.');
        const head = heads[0];
        const parent = head?.status === 'failed' ? head.id : null;
        const w = head && head.status !== 'failed' ? { evaluation: head, evidence: this.ledger.evidenceForAttempt(courseId, m.attemptId).find(e => e.evaluationId === head.id) ?? null } : await this.evaluations.evaluate(courseId, m.attemptId, parent ? `teaching:${id}:retry:${parent}` : `teaching:${id}:evaluate`, evaluator, parent);
        this.repo.attachOutcome(courseId, id, w);
        return this.move(s, id);
    }
    summary(courseId: string, id: string) { const s = this.get(courseId, id); if (!s.summary)
        throw new TeachingError('Summary is available after the session ends.'); return s.summary; }
    audit(courseId: string, id: string) { return { session: this.get(courseId, id), moves: this.moves(courseId, id).map(m => ({ ...m, evaluations: m.attemptId ? this.evaluations.list(courseId, m.attemptId) : [], support: this.repo.support(courseId, m.id) })) }; }
    abandon(courseId: string) { const s = this.active(courseId); return this.finish(s, s.state, 'learner_stopped'); }
}
