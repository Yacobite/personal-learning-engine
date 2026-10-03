import type { AssessmentTask, Attempt, EvaluationResult } from './assessment.ts';
import type { SourceRef, ResearchRef } from './curriculum.ts';
export const teachingPolicy = 'bounded-instruction-v1';
export const moveTypes = ['activate_prior_knowledge', 'explain', 'independent_practice', 'guided_practice', 'scaffold', 'teach_back', 'near_transfer'] as const;
export const teachingStops = ['instructional_goal_reached', 'move_budget_exhausted', 'learner_stopped', 'no_grounded_content', 'no_evaluable_check'] as const;
export type MoveType = typeof moveTypes[number];
export type Scaffold = 0 | 1 | 2 | 3 | 4;
export type EpisodeOutcome = 'completed_independently' | 'completed_with_support' | 'needs_more_instruction' | 'deferred';
export class TeachingError extends Error {
    constructor(message: string) { super(message); this.name = 'TeachingError'; }
}
export function teachingId(value: unknown, prefix: 'teaching' | 'move'): value is string {
    return typeof value === 'string' && new RegExp(`^${prefix}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).test(value);
}
export function scaffold(value: unknown): asserts value is Scaffold { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 4)
    throw new TeachingError('Invalid scaffold level.'); }
export const assistanceFor = (level: Scaffold): Attempt['assistance'] => level === 0 ? 'none' : level === 1 ? 'minimal' : level === 4 ? 'worked_solution' : 'guided';
export interface Episode {
    conceptId: string;
    phase: MoveType;
    level: Scaffold;
    failures: number;
    transfers: number;
    detoured: boolean;
    supported: boolean;
}
export interface TeachingState {
    episode: Episode | null;
    queue: string[];
    stack: Episode[];
    outcomes: {
        conceptId: string;
        outcome: EpisodeOutcome;
    }[];
}
export interface TeachingContent {
    components: Partial<Record<'coreIdea' | 'intuition' | 'formalStatement' | 'example' | 'nonExample' | 'confusion' | 'prerequisiteConnection', string>>;
    sourceRefs: readonly SourceRef[];
    researchRefs: readonly ResearchRef[];
    grounding?: {
        source: { ref: SourceRef; anchor: unknown; warnings: readonly string[] }[];
        research: { ref: ResearchRef; url: string }[];
    };
}
export interface TeachingMove {
    id: string;
    courseId: string;
    sessionId: string;
    curriculumVersion: number;
    sequence: number;
    conceptId: string;
    type: MoveType;
    reason: string;
    level: Scaffold;
    content: TeachingContent;
    taskId: string | null;
    attemptId: string | null;
    status: 'content' | 'outstanding' | 'answered' | 'resolved';
    createdAt: string;
    outcomes: {
        evaluationId: string;
        evidenceId: string | null;
    }[];
}
export interface TeachingSummary {
    asOf: string;
    curriculumVersion: number;
    diagnosticId: string | null;
    policy: string;
    stopReason: typeof teachingStops[number];
    outcomes: TeachingState['outcomes'];
    moves: {
        id: string;
        conceptId: string;
        type: MoveType;
        reason: string;
        level: Scaffold;
        taskId: string | null;
        attemptId: string | null;
        evaluationIds: string[];
        evidenceIds: string[];
        sourceRefs: readonly SourceRef[];
        researchRefs: readonly ResearchRef[];
    }[];
    nextRecommendations: string[];
    warning: string;
}
export interface TeachingSession {
    id: string;
    courseId: string;
    curriculumVersion: number;
    policy: string;
    diagnosticId: string | null;
    recommendations: string[];
    budget: number;
    status: 'in_progress' | 'completed' | 'abandoned';
    startedAt: string;
    endedAt: string | null;
    summary: TeachingSummary | null;
    state: TeachingState;
    revision: number;
}
export interface TeachingObservation {
    task: AssessmentTask;
    attempt: Attempt;
    heads: EvaluationResult[];
}
export const episode = (conceptId: string): Episode => ({ conceptId, phase: 'activate_prior_knowledge', level: 0, failures: 0, transfers: 0, detoured: false, supported: false });
