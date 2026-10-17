export class HealthError extends Error {
    constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'HealthError'; }
}
export interface DatabaseHealth {
    path: string | null;
    schemaVersion: number;
    expectedSchemaVersion: number;
    migrationHistory: 'valid' | 'invalid';
    foreignKeysEnabled: boolean;
    fts5Available: boolean;
    jsonAvailable: boolean;
    integrity: 'ok' | 'failed';
    foreignKeyViolations: number;
    course: null | {
        id: string;
        activeCurriculum: number | null;
        sources: number;
        diagnostic: string | null;
        teaching: string | null;
        stateRevisionId: string | null;
        pendingReviews: number;
        unresolvedReview: string | null;
    };
}
