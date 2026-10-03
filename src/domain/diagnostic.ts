import type { AssessmentTask, Attempt, EvaluationResult } from './assessment.ts';
export const diagnosticPolicy = 'prerequisite-frontier-v1';
export type FindingState = 'not_probed' | 'provisionally_supported' | 'provisionally_unsupported' | 'mixed' | 'uncertain';
export type StopReason = 'budget_exhausted' | 'coverage_sufficient' | 'frontier_located' | 'no_eligible_probe' | 'learner_stopped';
export interface Observation {
    attemptId: string;
    taskId: string;
    conceptIds: readonly string[];
    type: AssessmentTask['type'];
    representation: AssessmentTask['representation'];
    novelty: AssessmentTask['novelty'];
    assistance: Attempt['assistance'];
    submittedAt: string;
    evaluations: readonly string[];
    evidenceIds: readonly string[];
    state: Exclude<FindingState, 'not_probed' | 'mixed'>;
    reason: string;
}
export interface Finding {
    conceptId: string;
    state: FindingState;
    observations: Observation[];
}
export interface DiagnosticSummary {
    policy: string;
    curriculumVersion: number;
    asOf: string;
    stopReason: StopReason;
    findings: Finding[];
    priorObservations: Observation[];
    frontier: {
        conceptId: string;
        reason: 'direct_difficulty' | 'uncertain' | 'untested_prerequisite';
    }[];
    warning: string;
}
export interface DiagnosticSession {
    id: string;
    courseId: string;
    curriculumVersion: number;
    policy: string;
    budget: number;
    status: 'in_progress' | 'completed' | 'abandoned';
    startedAt: string;
    endedAt: string | null;
    stopReason: StopReason | null;
    summary: DiagnosticSummary | null;
    priorAttemptIds: string[];
}
export interface DiagnosticProbe {
    id: string;
    courseId: string;
    sessionId: string;
    curriculumVersion: number;
    sequence: number;
    conceptId: string;
    taskId: string;
    attemptId: string | null;
    status: 'outstanding' | 'answered' | 'resolved' | 'skipped';
    selectionReason: string;
    createdAt: string;
    answeredAt: string | null;
    resolvedAt: string | null;
    outcomes: {
        evaluationId: string;
        evidenceId: string | null;
    }[];
}
export class DiagnosticError extends Error {
    constructor(message: string) { super(message); this.name = 'DiagnosticError'; }
}
export function diagnosticId(value: string, prefix: 'diagnostic' | 'probe'): boolean {
    return new RegExp(`^${prefix}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).test(value);
}
export function interpret(task: AssessmentTask, attempt: Attempt, heads: readonly EvaluationResult[], evidenceIds: readonly string[]): Observation {
    let state: Observation['state'] = 'uncertain';
    let reason = 'no_terminal_evaluation';
    const head = heads[0];
    if (heads.length > 1)
        reason = 'conflicting_terminal_heads';
    else if (head) {
        if (task.conceptIds.length !== 1)
            reason = 'ambiguous_multiple_targets';
        else if (attempt.assistance === 'ai_performed')
            reason = 'ai_performed_excluded';
        else if (attempt.assistance !== 'none' || attempt.hints.count !== 0)
            reason = 'assisted_observation';
        else if (head.status !== 'scored')
            reason = head.status;
        else if (head.correctness === 1) {
            state = 'provisionally_supported';
            reason = 'independent_correct';
        }
        else if (head.correctness === 0) {
            state = 'provisionally_unsupported';
            reason = 'independent_incorrect';
        }
        else
            reason = 'partial_score';
    }
    return { attemptId: attempt.id, taskId: task.id, conceptIds: task.conceptIds, type: task.type,
        representation: task.representation, novelty: task.novelty, assistance: attempt.assistance,
        submittedAt: attempt.submittedAt, evaluations: heads.map(e => e.id), evidenceIds: [...evidenceIds], state, reason };
}
export function findings(ids: readonly string[], observations: readonly Observation[]): Finding[] {
    return ids.map(conceptId => {
        const selected = observations.filter(o => o.conceptIds.includes(conceptId));
        const states = new Set(selected.map(o => o.state));
        const state: FindingState = !selected.length ? 'not_probed'
            : states.has('provisionally_supported') && states.has('provisionally_unsupported') ? 'mixed'
                : states.has('uncertain') ? 'uncertain' : selected[0]!.state;
        return { conceptId, state, observations: selected };
    });
}
