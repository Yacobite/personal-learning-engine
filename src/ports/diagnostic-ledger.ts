import type { Attempt, EvidenceEvent } from '../domain/assessment.ts';
/** Read-only M4 queries; no truncated recent-evidence window. */
export interface DiagnosticLedger {
    attemptsForVersion(courseId: string, version: number): Attempt[];
    evidenceForAttempt(courseId: string, attemptId: string): EvidenceEvent[];
    attemptOperation(courseId: string, operationId: string): Attempt | undefined;
}
