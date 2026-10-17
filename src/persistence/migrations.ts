import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { curriculumMigration } from './migration-4.ts';
import { assessmentMigration } from './migration-5.ts';
import { diagnosticMigration } from './migration-6.ts';
import { teachingMigration } from './migration-7.ts';
import { reviewMigration } from './migration-9.ts';
import { learnerStateMigration } from './migration-8.ts';

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
  {
    version: 3,
    name: 'versioned-sources-and-fts',
    sql: `CREATE TABLE sources (
      id TEXT PRIMARY KEY NOT NULL CHECK (
        id GLOB 'source-????????-????-4???-[89ab]???-????????????'
        AND substr(id, 8) NOT GLOB '*[^0-9a-f-]*'
        AND length(replace(substr(id, 8), '-', '')) = 32
      ),
      course_id TEXT NOT NULL REFERENCES courses(id),
      identity_key TEXT NOT NULL CHECK (length(trim(identity_key)) > 0),
      kind TEXT NOT NULL CHECK (kind IN ('pdf','pptx','markdown','text','web','youtube')),
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      origin TEXT NOT NULL CHECK (origin IN ('learner_file','learner_url')),
      current_version INTEGER NOT NULL CHECK (current_version > 0),
      status TEXT NOT NULL CHECK (status IN ('ready','ready_with_warnings','extraction_incomplete','failed','transcript_unavailable')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(course_id, identity_key),
      FOREIGN KEY (id, current_version) REFERENCES source_versions(source_id, version) DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
    CREATE TABLE source_versions (
      source_id TEXT NOT NULL REFERENCES sources(id),
      version INTEGER NOT NULL CHECK (version > 0),
      content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
      location TEXT NOT NULL,
      ingested_at TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('learner_file','learner_url')),
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ready','ready_with_warnings','extraction_incomplete','failed','transcript_unavailable')),
      parser TEXT NOT NULL,
      warnings_json TEXT NOT NULL CHECK (json_valid(warnings_json)),
      metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
      PRIMARY KEY(source_id, version),
      UNIQUE(source_id, content_hash)
    ) STRICT;
    CREATE TABLE source_segments (
      id TEXT PRIMARY KEY NOT NULL,
      source_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      segment_order INTEGER NOT NULL CHECK (segment_order >= 0),
      text TEXT NOT NULL,
      heading_path_json TEXT NOT NULL CHECK (json_valid(heading_path_json)),
      anchor_json TEXT NOT NULL CHECK (json_valid(anchor_json)),
      visual_refs_json TEXT NOT NULL CHECK (json_valid(visual_refs_json)),
      FOREIGN KEY(source_id, version) REFERENCES source_versions(source_id, version),
      UNIQUE(source_id, version, segment_order)
    ) STRICT;
    CREATE VIRTUAL TABLE source_segments_fts USING fts5(text, segment_id UNINDEXED, tokenize='unicode61');
    CREATE INDEX sources_by_course ON sources(course_id);
    CREATE INDEX segments_by_version ON source_segments(source_id, version, segment_order);`,
  },
  curriculumMigration,
  assessmentMigration,
  diagnosticMigration,
  teachingMigration,
  learnerStateMigration,
  reviewMigration,
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
