import type { AssessmentTask, Attempt, EvaluationResult } from './assessment.ts';
export const learnerPolicies = { evidence: 'evidence-state-v1', gap: 'gap-escrow-v1', readiness: 'readiness-v1', profile: 'competence-profile-v1' } as const;
export const dimensionBands = ['untested', 'assisted_only', 'assisted_difficulty', 'independent_difficulty', 'mixed', 'provisional_support', 'durable_support'] as const;
export const gapStatuses = ['OPEN', 'REPAIR_IN_PROGRESS', 'AWAITING_VERIFICATION', 'VERIFIED_CLOSED'] as const;
export const competenceStages = ['not_ready', 'instructionally_ready', 'provisional_competence', 'durable_mastery', 'not_applicable'] as const;
export const verificationDelayMs = 86400000;
export type Dimension = AssessmentTask['intendedDimensions'][number];
export type Band = typeof dimensionBands[number];
export type GapStatus = typeof gapStatuses[number];
export type Stage = typeof competenceStages[number];
export class LearnerStateError extends Error {
    constructor(message: string) { super(message); this.name = 'LearnerStateError'; }
}
export function learnerId(value: unknown, prefix: 'state' | 'gap'): value is string {
    return typeof value === 'string' && new RegExp('^' + prefix + '-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').test(value);
}
/** Read-only M4 metadata. Neither responses nor scoring keys enter the projection. */
export interface PerformanceRecord {
    task: Pick<AssessmentTask, 'id' | 'curriculumVersion' | 'conceptIds' | 'type' | 'intendedDimensions' | 'representation' | 'novelty' | 'prompt'>;
    attempt: Pick<Attempt, 'id' | 'submittedAt' | 'assistance' | 'hints' | 'confidence'>;
    evaluations: (Pick<EvaluationResult, 'id' | 'supersedes' | 'status' | 'correctness' | 'createdAt'> & {
        evidenceId: string | null;
    })[];
}
export interface Observation {
    attemptId: string;
    taskId: string;
    originalVersion: number;
    conceptIds: readonly string[];
    dimensions: readonly Dimension[];
    type: AssessmentTask['type'];
    at: string;
    assistance: Attempt['assistance'];
    hints: {
        count: number;
        highestLevel: Attempt['assistance'];
    };
    novelty: AssessmentTask['novelty'];
    representation: AssessmentTask['representation'];
    promptHash: string;
    repeatedCase: boolean;
    confidence: number | null;
    heads: PerformanceRecord['evaluations'];
    independent: boolean;
    ambiguous: boolean;
    correctness: number | null;
}
export interface EvidenceRef {
    attemptId: string;
    evaluationId: string;
    evidenceId: string | null;
}
export interface DelayedState {
    status: 'no_prior_independent_success' | 'waiting_for_delayed_evidence' | 'satisfied';
    eligibleAfter: string | null;
    baselineAttemptId: string | null;
    verifiedAttemptId: string | null;
}
export interface DimensionState {
    conceptId: string;
    dimension: Dimension;
    band: Band;
    policy: string;
    qualifyingCount: number;
    independentSuccessCount: number;
    independentFailureCount: number;
    assistedSuccessCount: number;
    assistedFailureCount: number;
    partialCount: number;
    unscoredCount: number;
    failedCount: number;
    unevaluatedCount: number;
    ambiguousCount: number;
    aiPerformedCount: number;
    lastObservation: string | null;
    lastQualifyingObservation: string | null;
    lastIndependentSuccess: string | null;
    lastIndependentFailure: string | null;
    lastDelayedSuccess: string | null;
    highestNovelty: AssessmentTask['novelty'] | null;
    representations: AssessmentTask['representation'][];
    supporting: EvidenceRef[];
    contradictory: EvidenceRef[];
    contextual: EvidenceRef[];
    confidenceObservations: {
        attemptId: string;
        confidence: number;
        correctness: number;
    }[];
}
export interface GapIdentity {
    id: string;
    courseId: string;
    conceptId: string;
    dimension: Dimension;
    triggerAttemptId: string;
    policy: string;
}
export interface GapTransition {
    status: GapStatus;
    at: string;
    reason: 'performance_failure' | 'repair_evidence' | 'changed_independent_case' | 'delayed_verification' | 'failure_reset';
    ref: EvidenceRef;
    assistance: Attempt['assistance'];
}
export interface GapSnapshot extends GapIdentity {
    recursFrom: string | null;
    status: GapStatus;
    transitions: GapTransition[];
    awaitingAttemptId: string | null;
    eligibleAfter: string | null;
}
export interface ReadinessResult {
    conceptId: string;
    title: string;
    nodeType: string;
    stage: Stage;
    requiredDimensions: readonly Dimension[];
    delayed: DelayedState;
    gaps: string[];
    prerequisiteWarnings: string[];
    missingProvisional: string[];
    missingDurable: string[];
}
export interface LearnerStateRevision {
    id: string;
    courseId: string;
    curriculumVersion: number;
    number: number;
    policies: typeof learnerPolicies;
    createdAt: string;
    asOf: string;
    fingerprint: string;
    observations: Observation[];
    dimensions: DimensionState[];
    gaps: GapSnapshot[];
    readiness: ReadinessResult[];
}
export function evidenceRef(o: Observation): EvidenceRef | null {
    return o.heads.length === 1 ? { attemptId: o.attemptId, evaluationId: o.heads[0]!.id, evidenceId: o.heads[0]!.evidenceId } : null;
}
export function timestamp(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        throw new LearnerStateError('Expected a canonical UTC timestamp.');
}
