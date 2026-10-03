import { diagnosticPolicy, DiagnosticError, diagnosticId, interpret, findings } from '../domain/diagnostic.ts';
import type { DiagnosticSession, DiagnosticProbe, DiagnosticSummary, StopReason } from '../domain/diagnostic.ts';
import { selection, frontier } from '../domain/diagnostic-policy.ts';
import type { Submission } from '../domain/assessment.ts';
import type { DiagnosticRepository } from '../ports/diagnostic-repository.ts';
import type { DiagnosticLedger } from '../ports/diagnostic-ledger.ts';
import type { DiagnosticTaskGenerator, DiagnosticTaskContext } from '../ports/diagnostic-generator.ts';
import type { AnswerEvaluator } from '../ports/answer-evaluator.ts';
import type { GraphService } from './graph-service.ts';
import type { AssessmentService } from './assessment-service.ts';
import type { EvaluationService } from './evaluation-service.ts';
import { DiagnosticContextBuilder, diagnosticTask } from './diagnostic-context.ts';
export class DiagnosticService {
    private readonly repo: DiagnosticRepository;
    private readonly ledger: DiagnosticLedger;
    private readonly graphs: Pick<GraphService, 'get'>;
    private readonly assessments: AssessmentService;
    private readonly evaluations: EvaluationService;
    private readonly context: DiagnosticContextBuilder;
    private readonly id: (prefix: 'diagnostic' | 'probe') => string;
    private readonly clock: () => Date;
    constructor(repo: DiagnosticRepository, ledger: DiagnosticLedger, graphs: Pick<GraphService, 'get'>, assessments: AssessmentService, evaluations: EvaluationService, context: DiagnosticContextBuilder, id: (prefix: 'diagnostic' | 'probe') => string, clock: () => Date) {
        this.repo = repo;
        this.ledger = ledger;
        this.graphs = graphs;
        this.assessments = assessments;
        this.evaluations = evaluations;
        this.context = context;
        this.id = id;
        this.clock = clock;
    }
    start(courseId: string, budget = 6): DiagnosticSession {
        if (!Number.isSafeInteger(budget) || budget < 1 || budget > 20)
            throw new DiagnosticError('Diagnostic budget must be 1–20.');
        const existing = this.repo.current(courseId);
        if (existing) {
            if (existing.budget !== budget)
                throw new DiagnosticError('Active diagnostic has a different budget; resume or abandon it first.');
            return existing;
        }
        const graph = this.graphs.get(courseId);
        const id = this.id('diagnostic');
        if (!diagnosticId(id, 'diagnostic'))
            throw new DiagnosticError('Invalid diagnostic ID.');
        return this.repo.start({ id, courseId, curriculumVersion: graph.version, policy: diagnosticPolicy, budget, status: 'in_progress', startedAt: this.now(), endedAt: null, stopReason: null, summary: null,
            priorAttemptIds: this.ledger.attemptsForVersion(courseId, graph.version).map(a => a.id) });
    }
    current(courseId: string) { return this.repo.current(courseId); }
    history(courseId: string) { return this.repo.history(courseId); }
    get(courseId: string, id: string) { if (!diagnosticId(id, 'diagnostic'))
        throw new DiagnosticError('Invalid diagnostic ID.'); const s = this.repo.get(courseId, id); if (!s)
        throw new DiagnosticError('Diagnostic not found in this course.'); return s; }
    probes(courseId: string, id: string) { this.get(courseId, id); return this.repo.probes(courseId, id); }
    private active(courseId: string) { const s = this.current(courseId); if (!s)
        throw new DiagnosticError('Start a diagnostic first.'); return s; }
    private now() { return this.clock().toISOString(); }
    private observation(courseId: string, attemptId: string) { const a = this.assessments.attempt(courseId, attemptId); const task = this.assessments.task(courseId, a.taskId); const heads = this.evaluations.heads(courseId, attemptId); const headIds = new Set(heads.map(h => h.id)); return interpret(task, a, heads, this.ledger.evidenceForAttempt(courseId, attemptId).filter(e => headIds.has(e.evaluationId)).map(e => e.id)); }
    private state(s: DiagnosticSession) { const graph = this.graphs.get(s.courseId, s.curriculumVersion); this.recoverAttemptLinks(s); const probes = this.repo.probes(s.courseId, s.id); const observations = probes.filter(p => p.attemptId).map(p => this.observation(s.courseId, p.attemptId!)); return { graph, probes, findings: findings(graph.nodes.map(n => n.conceptId), observations), prior: s.priorAttemptIds.map(id => this.observation(s.courseId, id)) }; }
    private recoverAttemptLinks(s: DiagnosticSession) { if (s.status !== 'in_progress')
        return; for (const p of this.repo.probes(s.courseId, s.id).filter(p => p.status === 'outstanding')) {
        const a = this.ledger.attemptOperation(s.courseId, `diagnostic:${p.id}:submit`);
        if (a)
            this.repo.attachAttempt(s.courseId, p.id, a.id, a.submittedAt);
    } }
    audit(courseId: string, id: string) { const s = this.get(courseId, id); return { session: s, probes: this.probes(courseId, id).map(p => ({ ...p, evaluationLineage: p.attemptId ? this.evaluations.list(courseId, p.attemptId).map(e => ({ id: e.id, supersedes: e.supersedes, status: e.status })) : [], evidenceIds: p.attemptId ? this.ledger.evidenceForAttempt(courseId, p.attemptId).map(e => e.id) : [] })) }; }
    summary(courseId: string, id: string): DiagnosticSummary { const s = this.get(courseId, id); if (!s.summary)
        throw new DiagnosticError('Final summary is available only after completion or abandonment.'); return s.summary; }
    private finish(s: DiagnosticSession, reason: StopReason) {
        const v = this.state(s);
        return this.repo.finish(s.courseId, s.id, reason === 'learner_stopped' ? 'abandoned' : 'completed', {
            policy: s.policy, curriculumVersion: s.curriculumVersion, asOf: this.now(), stopReason: reason, findings: v.findings, priorObservations: v.prior, frontier: reason === 'learner_stopped' ? [] : frontier(v.graph, v.findings),
            warning: 'Provisional diagnostic observations only. No durable mastery, gaps, review scheduling or inferred prerequisite evidence. Prior observations affected priority only. Graph recommendations are not performance claims.'
        });
    }
    async next(courseId: string, generator: DiagnosticTaskGenerator): Promise<{
        session: DiagnosticSession;
        probe: DiagnosticProbe | null;
    }> {
        const s = this.active(courseId);
        const v = this.state(s);
        const pending = v.probes.find(p => p.status === 'outstanding' || p.status === 'answered');
        if (pending)
            return { session: s, probe: pending };
        // Pinned provenance determines structural eligibility, never a model response.
        // No unavailable concept consumes a probe or changes a performance finding.
        const contexts = new Map<string, DiagnosticTaskContext>();
        for (const node of v.graph.nodes) {
            const context = this.context.tryBuild(v.graph, node.conceptId, v.probes.length + 1);
            if (context)
                contexts.set(node.conceptId, context);
        }
        const probeable = new Set(contexts.keys());
        const decision = selection(v.graph, v.findings, v.probes, v.prior, s.budget, probeable);
        if ('stop' in decision)
            return { session: this.finish(s, decision.stop), probe: null };
        const ctx = contexts.get(decision.conceptId)!;
        // Provider work is outside transactions. A concurrent/replayed next is reconciled below.
        const value = await generator.propose(structuredClone(ctx));
        const input = diagnosticTask(ctx, value);
        const fresh = this.get(courseId, s.id);
        if (fresh.status !== 'in_progress')
            throw new DiagnosticError('Diagnostic ended during generation.');
        const freshProbes = this.repo.probes(courseId, s.id);
        const raced = freshProbes.find(p => p.status === 'outstanding' || p.status === 'answered');
        if (raced)
            return { session: fresh, probe: raced };
        if (freshProbes.length !== v.probes.length)
            throw new DiagnosticError('Diagnostic advanced during generation; retry next.');
        const freshState = this.state(fresh);
        const freshDecision = selection(freshState.graph, freshState.findings, freshState.probes, freshState.prior, fresh.budget, probeable);
        if ('stop' in freshDecision || freshDecision.conceptId !== decision.conceptId || freshDecision.reason !== decision.reason)
            throw new DiagnosticError('Diagnostic evidence changed during generation; retry next.');
        if (v.probes.some(p => this.assessments.task(courseId, p.taskId).prompt.trim() === input.prompt.trim()))
            throw new DiagnosticError('Generator repeated an existing diagnostic prompt.');
        const probeId = this.id('probe');
        if (!diagnosticId(probeId, 'probe'))
            throw new DiagnosticError('Invalid probe ID.');
        this.assessments.createTask(courseId, input, task => this.repo.insertProbe({ id: probeId, courseId, sessionId: s.id, curriculumVersion: s.curriculumVersion, sequence: v.probes.length + 1, conceptId: decision.conceptId, taskId: task.id, attemptId: null, status: 'outstanding', selectionReason: decision.reason, createdAt: this.now(), answeredAt: null, resolvedAt: null, outcomes: [] }));
        return { session: fresh, probe: this.repo.probes(courseId, s.id).find(p => p.id === probeId)! };
    }
    private probe(s: DiagnosticSession, id: string) { if (!diagnosticId(id, 'probe'))
        throw new DiagnosticError('Invalid probe ID.'); this.recoverAttemptLinks(s); const p = this.repo.probes(s.courseId, s.id).find(p => p.id === id); if (!p)
        throw new DiagnosticError('Probe not found in active diagnostic.'); return p; }
    async submit(courseId: string, probeId: string, value: Omit<Submission, 'taskId'>, evaluator: AnswerEvaluator) {
        const s = this.active(courseId);
        const p = this.probe(s, probeId);
        if (p.status === 'skipped')
            throw new DiagnosticError('Skipped probe cannot be answered.');
        if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).some(k => typeof k !== 'string' || !['response', 'assistance', 'hints', 'confidence', 'latencyMs', 'runtimeRef'].includes(k)))
            throw new DiagnosticError('Submission contains unexpected identity or control fields.');
        const a = this.assessments.submit(courseId, `diagnostic:${p.id}:submit`, { ...value, taskId: p.taskId });
        this.repo.attachAttempt(courseId, p.id, a.id, this.now());
        if (p.status !== 'resolved') {
            const w = await this.evaluations.evaluate(courseId, a.id, `diagnostic:${p.id}:evaluate`, evaluator);
            this.repo.attachOutcome(courseId, p.id, w, this.now());
        }
        return this.probe(s, p.id);
    }
    async retry(courseId: string, probeId: string, evaluator: AnswerEvaluator) {
        const s = this.active(courseId);
        const p = this.probe(s, probeId);
        if (p.status === 'resolved')
            return p;
        if (p.status !== 'answered' || !p.attemptId)
            throw new DiagnosticError('Submit an answer before retrying evaluation.');
        const heads = this.evaluations.heads(courseId, p.attemptId);
        if (heads.length > 1)
            throw new DiagnosticError('Conflicting evaluation heads require explicit M4 correction.');
        const head = heads[0];
        const parent = head?.status === 'failed' ? head.id : null;
        const key = parent ? `diagnostic:${p.id}:retry:${parent}` : `diagnostic:${p.id}:evaluate`;
        if (head?.status === 'failed')
            this.repo.attachOutcome(courseId, p.id, { evaluation: head, evidence: null }, this.now());
        // If an evaluation committed but its link failed, recover that exact write without regrading.
        const w = head && head.status !== 'failed' ? { evaluation: head, evidence: this.ledger.evidenceForAttempt(courseId, p.attemptId).find(e => e.evaluationId === head.id) ?? null } : await this.evaluations.evaluate(courseId, p.attemptId, key, evaluator, parent);
        this.repo.attachOutcome(courseId, p.id, w, this.now());
        return this.probe(s, p.id);
    }
    skip(courseId: string, probeId: string) { const s = this.active(courseId); this.probe(s, probeId); this.repo.skip(courseId, probeId, this.now()); return this.probe(s, probeId); }
    abandon(courseId: string) { return this.finish(this.active(courseId), 'learner_stopped'); }
}
