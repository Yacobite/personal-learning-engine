import type { SourceRef, ResearchRef } from './curriculum.ts';
export const taskTypes = ['recognition', 'cued_recall', 'free_recall', 'self_explanation', 'discrimination', 'prediction', 'procedure', 'representation_conversion', 'analogy', 'error_diagnosis', 'near_transfer', 'far_transfer', 'simulation', 'authentic_performance'] as const;
export const dimensions = ['memory_accessibility', 'structural_understanding', 'discrimination', 'application', 'transfer', 'representation_flexibility', 'procedural_fluency', 'scaffold_independence', 'calibration'] as const;
export const assistanceLevels = ['none', 'minimal', 'guided', 'worked_solution', 'ai_performed'] as const;
export const noveltyTypes = ['repeated', 'isomorphic', 'near_transfer', 'far_transfer', 'authentic'] as const;
export const representations = ['text', 'symbolic', 'numeric', 'code', 'table', 'graph', 'diagram', 'mixed'] as const;
export const origins = ['manual', 'curriculum_generated', 'source_derived', 'imported'] as const;
// Keep origins frozen: migration 5 uses that historical vocabulary.
export const currentOrigins = [...origins, 'review_generated'] as const;
export type Normalization = 'exact' | 'trim' | 'trim_lowercase';
export type ScoringSpec = {
    readonly kind: 'text';
    readonly expected: string;
    readonly normalization: Normalization;
} | {
    readonly kind: 'choice';
    readonly options: readonly string[];
    readonly expected: string;
} | {
    readonly kind: 'numeric';
    readonly expected: number;
    readonly tolerance: number;
} | {
    readonly kind: 'set';
    readonly expected: readonly string[];
    readonly normalization: Normalization;
    readonly duplicates: 'ignore' | 'reject';
} | {
    readonly kind: 'open';
    readonly rubricVersion: string;
    readonly criteria: readonly {
        readonly key: string;
        readonly description: string;
    }[];
    readonly expected: string | null;
};
export interface TaskInput {
    readonly curriculumVersion?: number;
    readonly conceptIds: readonly string[];
    readonly type: typeof taskTypes[number];
    readonly intendedDimensions: readonly typeof dimensions[number][];
    readonly representation: typeof representations[number];
    readonly novelty: typeof noveltyTypes[number];
    readonly origin: typeof currentOrigins[number];
    readonly prompt: string;
    readonly scoring: ScoringSpec;
    readonly sourceRefs: readonly SourceRef[];
    readonly researchRefs: readonly ResearchRef[];
}
export interface AssessmentTask extends Omit<TaskInput, 'curriculumVersion'> {
    readonly id: string;
    readonly courseId: string;
    readonly curriculumVersion: number;
    readonly createdAt: string;
}
export interface Submission {
    readonly taskId: string;
    readonly response: string;
    readonly assistance: typeof assistanceLevels[number];
    readonly hints: {
        readonly count: number;
        readonly highestLevel: typeof assistanceLevels[number];
        readonly notes: string | null;
    };
    readonly confidence?: number;
    readonly latencyMs?: number;
    readonly runtimeRef?: string;
}
export interface Attempt extends Submission {
    readonly id: string;
    readonly courseId: string;
    readonly submittedAt: string;
    readonly curriculumVersion: number;
    readonly conceptIds: readonly string[];
    readonly novelty: AssessmentTask['novelty'];
    readonly representation: AssessmentTask['representation'];
    readonly operationId: string;
    readonly requestHash: string;
}
export interface EvaluatorIdentity {
    readonly kind: 'deterministic' | 'llm' | 'human';
    readonly name: string;
    readonly version: string;
    readonly policyVersion: string;
    readonly provider?: string;
    readonly model?: string;
}
export interface EvaluationProposal {
    readonly status: 'scored' | 'unscored' | 'failed';
    readonly correctness: number | null;
    readonly rubricScores: Readonly<Record<string, number>>;
    readonly rationale: string;
}
export interface EvaluationResult extends EvaluationProposal {
    readonly id: string;
    readonly courseId: string;
    readonly attemptId: string;
    readonly evaluator: EvaluatorIdentity;
    readonly createdAt: string;
    readonly supersedes: string | null;
    readonly operationId: string;
    readonly requestHash: string;
}
export interface EvidenceEvent {
    readonly id: string;
    readonly courseId: string;
    readonly attemptId: string;
    readonly evaluationId: string;
    readonly createdAt: string;
}
export interface EvidenceAudit {
    readonly event: EvidenceEvent;
    readonly task: AssessmentTask;
    readonly attempt: Attempt;
    readonly evaluation: EvaluationResult;
}
export interface EvaluationWrite {
    readonly evaluation: EvaluationResult;
    readonly evidence: EvidenceEvent | null;
}
export class AssessmentError extends Error {
    constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'AssessmentError'; }
}
export function isAssessmentId(value: unknown, prefix: 'task' | 'attempt' | 'evaluation' | 'evidence'): value is string {
    return typeof value === 'string' && new RegExp(`^${prefix}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).test(value);
}
