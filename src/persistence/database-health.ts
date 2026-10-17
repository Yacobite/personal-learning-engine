import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.ts';
import { HealthError } from '../domain/health.ts';
import type { DatabaseHealth } from '../domain/health.ts';
import type { HealthStore } from '../ports/health-store.ts';
/** Validate existing rows without migrating or rewriting the ledger. */
export function validateMigrationHistory(db: DatabaseSync, requireCurrent = true): number {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    const rows = exists ? db.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all() : [];
    if (rows.some(row => Number(row.version) > migrations.length))
        throw new HealthError('Database schema is newer than this engine version; refusing to open it. No downgrade was attempted.');
    for (const [index, row] of rows.entries()) {
        const m = migrations[index];
        if (!m || row.version !== m.version || row.name !== m.name || row.checksum !== createHash('sha256').update(JSON.stringify([m.version, m.name, m.sql])).digest('hex'))
            throw new HealthError('Invalid migration history; no database reset or repair was attempted.');
    }
    if (requireCurrent && rows.length !== migrations.length)
        throw new HealthError('Database schema is incomplete for this engine; initialize through normal startup.');
    return rows.length;
}
export function checkDatabaseCapabilities(db: DatabaseSync): void {
    if (db.prepare('PRAGMA foreign_keys').get()!.foreign_keys !== 1)
        throw new HealthError('SQLite foreign keys must be enabled.');
    if (db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get()!.enabled !== 1)
        throw new HealthError('SQLite FTS5 is required.');
    if (db.prepare("SELECT json_valid('{}') AS available").get()!.available !== 1)
        throw new HealthError('SQLite JSON support is required.');
    validateMigrationHistory(db);
}
export class SqliteHealthStore implements HealthStore {
    private readonly db: DatabaseSync;
    constructor(db: DatabaseSync) { this.db = db; }
    diagnose(courseId?: string): DatabaseHealth {
        const owned = !this.db.isTransaction;
        if (owned)
            this.db.exec('BEGIN');
        try {
            let migrationHistory: DatabaseHealth['migrationHistory'] = 'valid';
            try {
                validateMigrationHistory(this.db);
            }
            catch {
                migrationHistory = 'invalid';
            }
            const schema = Number(this.db.prepare('SELECT coalesce(max(version),0) AS version FROM schema_migrations').get()!.version);
            const integrity = this.db.prepare('PRAGMA integrity_check').all();
            const violations = this.db.prepare('PRAGMA foreign_key_check').all().length;
            let course: DatabaseHealth['course'] = null;
            if (courseId && this.db.prepare('SELECT 1 FROM courses WHERE id=?').get(courseId)) {
                const active = this.db.prepare('SELECT version FROM course_curriculum_current WHERE course_id=?').get(courseId);
                const version = active ? Number(active.version) : null;
                const current = version === null ? undefined : this.db.prepare('SELECT revision_id FROM learner_current WHERE course_id=? AND curriculum_version=?').get(courseId, version);
                const diagnostic = this.db.prepare("SELECT id FROM diagnostic_sessions WHERE course_id=? AND status='in_progress'").get(courseId);
                const teaching = this.db.prepare("SELECT id FROM teaching_sessions WHERE course_id=? AND status='in_progress'").get(courseId);
                const review = this.db.prepare("SELECT item_id FROM review_progress WHERE course_id=? AND status IN ('active','awaiting_evaluation')").get(courseId);
                course = { id: courseId, activeCurriculum: version, sources: Number(this.db.prepare('SELECT count(*) AS n FROM sources WHERE course_id=?').get(courseId)!.n),
                    diagnostic: diagnostic ? String(diagnostic.id) : null, teaching: teaching ? String(teaching.id) : null, stateRevisionId: current ? String(current.revision_id) : null,
                    pendingReviews: Number(this.db.prepare("SELECT count(*) AS n FROM review_progress WHERE course_id=? AND status IN ('scheduled','active','awaiting_evaluation')").get(courseId)!.n), unresolvedReview: review ? String(review.item_id) : null };
            }
            const result: DatabaseHealth = { path: this.db.location(), schemaVersion: schema, expectedSchemaVersion: migrations.length, migrationHistory,
                foreignKeysEnabled: this.db.prepare('PRAGMA foreign_keys').get()!.foreign_keys === 1,
                fts5Available: this.db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get()!.enabled === 1,
                jsonAvailable: this.db.prepare("SELECT json_valid('{}') AS available").get()!.available === 1,
                integrity: integrity.length === 1 && Object.values(integrity[0]!)[0] === 'ok' ? 'ok' : 'failed', foreignKeyViolations: violations, course };
            if (owned)
                this.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            if (owned)
                this.db.exec('ROLLBACK');
            throw new HealthError('Database health inspection failed. No automatic repair or reset was attempted; stop writers and preserve a backup.', { cause: error });
        }
    }
}
