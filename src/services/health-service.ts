import type { HealthStore } from '../ports/health-store.ts';
export class HealthService {
    private readonly store: HealthStore;
    private readonly nodeVersion: string;
    constructor(store: HealthStore, nodeVersion: string) { this.store = store; this.nodeVersion = nodeVersion; }
    inspect(courseId?: string) {
        const database = this.store.diagnose(courseId);
        const [major, minor] = this.nodeVersion.split('.').map(Number);
        const nodeSupported = major === 24 && minor !== undefined && minor >= 19;
        return { healthy: nodeSupported && database.migrationHistory === 'valid' && database.schemaVersion === database.expectedSchemaVersion
                && database.foreignKeysEnabled && database.fts5Available && database.jsonAvailable && database.integrity === 'ok' && database.foreignKeyViolations === 0,
            runtime: { nodeVersion: this.nodeVersion, nodeSupported }, database,
            message: 'Read-only health inspection. No learner state or review schedules were refreshed. Back up before any manual repair; no automatic repair is performed.' };
    }
}
