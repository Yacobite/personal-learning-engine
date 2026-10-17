import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FoundationStatus } from '../domain/foundation-status.ts';
import type { FoundationStore } from '../ports/foundation-store.ts';
import { SqliteHealthStore, checkDatabaseCapabilities, validateMigrationHistory } from './database-health.ts';
import { applyMigrations } from './migrations.ts';
import { SqliteCourseRepository } from './course-repository.ts';
import { SqliteSourceRepository } from './source-repository.ts';
import { SqliteGraphRepository } from './graph-repository.ts';
import { SqliteResearchRepository } from './research-repository.ts';
import { SqliteAssessmentRepository } from './assessment-repository.ts';
import { SqliteDiagnosticRepository } from './diagnostic-repository.ts';
import { SqliteTeachingRepository } from './teaching-repository.ts';
import { SqliteReviewRepository } from './review-repository.ts';
import { SqliteLearnerLedger } from './learner-ledger.ts';
import { SqliteLearnerStateRepository } from './learner-state-repository.ts';

function resolveDatabasePath(workspaceRoot: string): string {
  const root = realpathSync(workspaceRoot);
  const directory = join(root, '_learning');
  mkdirSync(directory, { recursive: true });
  const resolvedDirectory = realpathSync(directory);
  const withinRoot = relative(root, resolvedDirectory);
  if (isAbsolute(withinRoot) || withinRoot === '..' || withinRoot.startsWith(`..${sep}`)) {
    throw new Error('Learning database directory must remain inside the workspace.');
  }
  if (lstatSync(directory).isSymbolicLink()) {
    throw new Error('Learning database directory must be a real project-local directory, not a symbolic link.');
  }
  const databasePath = join(resolvedDirectory, 'learning.db');
  if (lstatSync(databasePath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('Learning database must not be a symbolic link.');
  }
  return databasePath;
}

export class SqliteFoundationStore implements FoundationStore {
  readonly health: SqliteHealthStore;
  readonly courses: SqliteCourseRepository;
  readonly sources: SqliteSourceRepository;
  readonly graphs: SqliteGraphRepository;
  readonly research: SqliteResearchRepository;
  readonly assessments: SqliteAssessmentRepository;
  readonly diagnostics: SqliteDiagnosticRepository;
  readonly teaching: SqliteTeachingRepository;
  readonly reviews: SqliteReviewRepository;
  readonly learnerLedger: SqliteLearnerLedger;
  readonly learnerState: SqliteLearnerStateRepository;
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(database: DatabaseSync) {
    this.database = database;
    this.health = new SqliteHealthStore(database);
    this.courses = new SqliteCourseRepository(database);
    this.sources = new SqliteSourceRepository(database);
    this.graphs = new SqliteGraphRepository(database);
    this.research = new SqliteResearchRepository(database);
    this.assessments = new SqliteAssessmentRepository(database);
    this.diagnostics = new SqliteDiagnosticRepository(database);
    this.teaching = new SqliteTeachingRepository(database);
    this.reviews = new SqliteReviewRepository(database);
    this.learnerLedger = new SqliteLearnerLedger(database);
    this.learnerState = new SqliteLearnerStateRepository(database);
  }

  readStatus(): FoundationStatus {
    const schema = this.database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
    const sqlite = this.database.prepare('SELECT sqlite_version() AS version').get();
    const fts = this.database.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get();
    return {
      schemaVersion: Number(schema?.version),
      sqliteVersion: String(sqlite?.version),
      fts5Available: fts?.enabled === 1,
    };
  }

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}

export function openLearningDatabase(workspaceRoot: string): SqliteFoundationStore {
  const database = new DatabaseSync(resolveDatabasePath(workspaceRoot), { timeout: 5000 });
  try {
    database.exec('PRAGMA foreign_keys = ON');
    validateMigrationHistory(database, false);
    applyMigrations(database);
    checkDatabaseCapabilities(database);
    return new SqliteFoundationStore(database);
  } catch (error) {
    database.close();
    throw error;
  }
}
