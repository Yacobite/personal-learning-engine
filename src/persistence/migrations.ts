import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'migration-ledger',
    sql: `CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;`,
  },
  {
    version: 2,
    name: 'durable-courses',
    sql: `CREATE TABLE courses (
      id TEXT PRIMARY KEY NOT NULL CHECK (
        id GLOB 'course-????????-????-4???-[89ab]???-????????????'
        AND substr(id, 8) NOT GLOB '*[^0-9a-f-]*'
      ),
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      mode TEXT NOT NULL CHECK (mode IN ('source_grounded', 'generated_curriculum', 'hybrid')),
      objective TEXT NOT NULL CHECK (length(trim(objective)) > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;`,
  },
];

function checksum(migration: Migration): string {
  return createHash('sha256')
    .update(JSON.stringify([migration.version, migration.name, migration.sql]))
    .digest('hex');
}

/** Serializes initialization and applies pending migrations atomically. */
export function applyMigrations(
  database: DatabaseSync,
  definitions: readonly Migration[] = migrations,
): void {
  if (definitions.length === 0 || definitions.some((item, index) => item.version !== index + 1)) {
    throw new Error('Migrations must be ordered consecutive versions starting at 1.');
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    const hasLedger = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    ).get();
    const applied = hasLedger
      ? database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all()
      : [];

    for (const [index, row] of applied.entries()) {
      const definition = definitions[index];
      if (!definition || row.version !== definition.version || row.name !== definition.name
        || row.checksum !== checksum(definition)) {
        throw new Error('Unknown, modified, or nonconsecutive migration history; refusing to initialize.');
      }
    }

    for (const definition of definitions.slice(applied.length)) {
      database.exec(definition.sql);
      database.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(definition.version, definition.name, checksum(definition), new Date().toISOString());
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
