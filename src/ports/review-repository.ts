import type { ReviewItem, ReviewEvent, ReviewStatus } from '../domain/review.ts';
import type { EvaluationWrite } from '../domain/assessment.ts';
export interface ReviewRepository {
    list(courseId: string): ReviewItem[];
    get(courseId: string, id: string): ReviewItem | undefined;
    /** One short transaction. Build must be synchronous and use the supplied latest history. */
    reconcile(courseId: string, stateRevisionId: string, at: string, build: (history: ReviewItem[]) => ReviewItem[], fingerprint: string): void;
    /** Called within M4's task transaction; fails if selection changed during generation. */
    linkTask(courseId: string, id: string, taskId: string, at: string, stateRevisionId: string): void;
    attachAttempt(courseId: string, id: string, attemptId: string, at: string): void;
    attachOutcome(courseId: string, id: string, write: EvaluationWrite, at: string): void;
    transition(courseId: string, id: string, status: ReviewStatus, at: string, reason: string): void;
    events(courseId: string, id: string): ReviewEvent[];
}
