import type { AssessmentTask } from './assessment.ts';
import { dimensions, taskTypes, representations, noveltyTypes } from './assessment.ts';
import { isConceptId } from './curriculum.ts';
import { isCourseId } from './course.ts';
import { learnerId, timestamp } from './learner-state.ts';
import type { Dimension, Observation } from './learner-state.ts';
export const reviewPolicies = { spacing: 'evidence-spacing-v1', queue: 'review-queue-v1', task: 'review-task-v1' } as const;
export const reviewKinds = ['delayed_verification', 'gap_verification', 'maintenance'] as const;
export const reviewStatuses = ['scheduled', 'active', 'awaiting_evaluation', 'completed', 'superseded', 'cancelled'] as const;
export type ReviewKind = typeof reviewKinds[number];
export type ReviewStatus = typeof reviewStatuses[number];
export type ReviewOutcome = 'qualifying_success' | 'assisted_success' | 'ai_performed' | 'failure' | 'partial' | 'unscored' | 'evaluation_failed' | 'ambiguous';
export class ReviewError extends Error {
    constructor(message: string) { super(message); this.name = 'ReviewError'; }
}
export interface ReviewConstraints {
    dimension: Dimension;
    type: AssessmentTask['type'];
    representation: AssessmentTask['representation'];
    novelty: AssessmentTask['novelty'];
    assistance: 'none';
}
export interface ReviewCandidate extends ReviewConstraints {
    courseId: string;
    curriculumVersion: number;
    conceptId: string;
    kind: ReviewKind;
    policies: typeof reviewPolicies;
    earliestAt: string;
    dueAt: string;
    stage: number;
    stateRevisionId: string;
    gapId: string | null;
    basis: string;
    episode: string;
}
export interface ReviewItem extends ReviewCandidate {
    id: string;
    createdAt: string;
    status: ReviewStatus;
    taskId: string | null;
    attemptId: string | null;
    completedAt: string | null;
}
export interface ReviewEvent {
    ordinal: number;
    kind: ReviewStatus | 'task_linked' | 'outcome_linked';
    at: string;
    reason: string;
    evaluationId: string | null;
    evidenceId: string | null;
}
export function reviewId(value: unknown): value is string {
    return typeof value === 'string' && /^review-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function validateReview(item: ReviewItem): void {
    if (!reviewId(item.id) || !isCourseId(item.courseId) || !isConceptId(item.conceptId) || !learnerId(item.stateRevisionId, 'state')
        || (item.gapId !== null && !learnerId(item.gapId, 'gap')) || !Number.isSafeInteger(item.curriculumVersion) || item.curriculumVersion < 1
        || !reviewKinds.includes(item.kind) || !reviewStatuses.includes(item.status) || !dimensions.includes(item.dimension) || item.dimension === 'calibration'
        || !taskTypes.includes(item.type) || !representations.includes(item.representation) || !noveltyTypes.includes(item.novelty) || item.novelty === 'repeated'
        || (item.dimension === 'transfer' && !['near_transfer', 'far_transfer', 'authentic'].includes(item.novelty))
        || item.assistance !== 'none' || !Number.isSafeInteger(item.stage) || item.stage < 0 || item.stage > 4
        || !/^[a-f0-9]{64}$/.test(item.basis) || !item.episode || item.policies.spacing !== reviewPolicies.spacing || item.policies.queue !== reviewPolicies.queue || item.policies.task !== reviewPolicies.task
        || ((item.kind === 'gap_verification') !== (item.gapId !== null)))
        throw new ReviewError('Invalid review identity, constraints or scheduling metadata.');
    for (const at of [item.earliestAt, item.dueAt, item.createdAt])
        timestamp(at);
    if (item.dueAt < item.earliestAt)
        throw new ReviewError('Review due time precedes eligibility.');
}
export function temporalStatus(item: Pick<ReviewItem, 'earliestAt' | 'dueAt'>, now: string) {
    timestamp(now);
    return now < item.earliestAt ? 'upcoming' : now > item.dueAt ? 'overdue' : 'due';
}
export function reviewLimit(limit = 10): number {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        throw new ReviewError('Review limit must be 1–50.');
    return limit;
}
/** Scheduling classification over M7's read-only M4 metadata; never a competence projection. */
export function reviewOutcome(item: ReviewItem, o: Observation): ReviewOutcome {
    if (o.ambiguous || o.heads.length > 1 || o.conceptIds.length !== 1 || o.conceptIds[0] !== item.conceptId || !o.dimensions.includes(item.dimension)
        || (item.taskId !== null && o.taskId !== item.taskId) || o.originalVersion !== item.curriculumVersion)
        return 'ambiguous';
    const head = o.heads[0];
    if (!head || head.status === 'failed')
        return 'evaluation_failed';
    if (o.assistance === 'ai_performed')
        return 'ai_performed';
    if (head.status !== 'scored' || !head.evidenceId)
        return 'unscored';
    if (o.correctness === 0)
        return 'failure';
    if (o.correctness !== 1)
        return 'partial';
    if (!o.independent)
        return 'assisted_success';
    if (o.at < item.earliestAt || o.repeatedCase || noveltyTypes.indexOf(o.novelty) < noveltyTypes.indexOf(item.novelty)
        || o.type !== item.type || o.representation !== item.representation)
        return 'ambiguous';
    return 'qualifying_success';
}
