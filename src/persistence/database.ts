import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FoundationStatus } from '../domain/foundation-status.ts';
import type { FoundationStore } from '../ports/foundation-store.ts';
import { applyMigrations } from './migrations.ts';
import { SqliteCourseRepository } from './course-repository.ts';

function resolveDatabasePath(workspaceRoot: string): string {
  const root = realpathSync(workspaceRoot);
  const directory = join(root, '_learning');
  mkdirSync(directory, { recursive: true });
  const resolvedDirectory = realpathSync(directory);
  const withinRoot = relative(root, resolvedDirectory);
  if (isAbsolute(withinRoot) || withinRoot === '..' || withinRoot.startsWith(`..${sep}`)) {
    throw new Error('Learning database directory must remain inside the workspace.');
  }
  const databasePath = join(resolvedDirectory, 'learning.db');
  if (lstatSync(databasePath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('Learning database must not be a symbolic link.');
  }
  return databasePath;
}

export class SqliteFoundationStore implements FoundationStore {
  readonly courses: SqliteCourseRepository;
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(database: DatabaseSync) {
    this.database = database;
    this.courses = new SqliteCourseRepository(database);
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
    applyMigrations(database);
    return new SqliteFoundationStore(database);
  } catch (error) {
    database.close();
    throw error;
  }
}
