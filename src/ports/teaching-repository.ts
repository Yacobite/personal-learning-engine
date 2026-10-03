import type { TeachingSession, TeachingMove, TeachingState, TeachingSummary, Scaffold } from '../domain/teaching.ts';
import type { EvaluationWrite } from '../domain/assessment.ts';
export interface TeachingRepository {
    start(session: TeachingSession): TeachingSession;
    current(courseId: string): TeachingSession | undefined;
    get(courseId: string, id: string): TeachingSession | undefined;
    history(courseId: string): TeachingSession[];
    moves(courseId: string, sessionId: string): TeachingMove[];
    insert(move: TeachingMove, revision: number, state: TeachingState, hintFor: string | null): void;
    content(move: TeachingMove, revision: number, state: TeachingState, hintFor: string | null): void;
    support(courseId: string, moveId: string): {
        count: number;
        level: Scaffold;
    };
    attachAttempt(courseId: string, moveId: string, attemptId: string): void;
    attachOutcome(courseId: string, moveId: string, write: EvaluationWrite): void;
    finish(courseId: string, id: string, summary: TeachingSummary, state: TeachingState): TeachingSession;
}
