import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { CourseError } from '../src/domain/course.ts';
import type { Course } from '../src/domain/course.ts';
import { SqliteCourseRepository } from '../src/persistence/course-repository.ts';
import { openLearningDatabase } from '../src/persistence/database.ts';
import { applyMigrations, migrations } from '../src/persistence/migrations.ts';
import { CourseService } from '../src/services/course-service.ts';

const id = 'course-00000000-0000-4000-8000-000000000001';
const course: Course = {
  id, title: "Logic'); DROP TABLE courses; --", mode: 'source_grounded', objective: 'Learn logic',
  createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:00.000Z',
};

test('upgrades an M0 ledger without changing migration 1 and applies migration 2 exactly once', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const first = migrations[0]!;
    const originalChecksum = '7f4effbc7084f5e36165e0e1dcfa0211b38dabb3c9cf31096af50748a27309d5';
    assert.equal(createHash('sha256').update(JSON.stringify([first.version, first.name, first.sql])).digest('hex'), originalChecksum);
    // Fixed M0 schema and historical checksum, independent of the current migration SQL.
    database.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
    ) STRICT;`);
    database.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)')
      .run(1, 'migration-ledger', originalChecksum, '2026-10-03T12:00:00.000Z');
    const before = database.prepare('SELECT * FROM schema_migrations WHERE version = ?').get(1);
    applyMigrations(database);
    const ledger = database.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    applyMigrations(database);
    assert.deepEqual(database.prepare('SELECT * FROM schema_migrations WHERE version = ?').get(1), before);
    assert.deepEqual(database.prepare('SELECT * FROM schema_migrations ORDER BY version').all(), ledger);
    assert.deepEqual(ledger.map((row) => row.version), [1, 2]);
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all().map((row) => row.name), ['courses', 'schema_migrations']);
  } finally { database.close(); }
});

test('SQLite maps domain objects explicitly and courses survive database restart', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'learning-m1-restart-'));
  try {
    const first = openLearningDatabase(workspace);
    first.courses.create(course);
    assert.deepEqual(first.courses.getById(id), course);
    assert.deepEqual(first.courses.list(), [course]);
    assert.equal(first.courses.getById("' OR 1=1 --"), undefined);
    first.close();
    const second = openLearningDatabase(workspace);
    try {
      assert.deepEqual(second.courses.getById(id), course);
      assert.deepEqual(second.courses.list(), [course]);
    } finally { second.close(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('repository constraints, collisions and database failures leave no partial courses', () => {
  const database = new DatabaseSync(':memory:');
  try {
    applyMigrations(database);
    const repository = new SqliteCourseRepository(database);
    for (const invalid of [{ ...course, id: '../unsafe' }, { ...course, title: '' },
      { ...course, mode: 'invalid' } as unknown as Course, { ...course, objective: '' }]) {
      assert.throws(() => repository.create(invalid));
      assert.deepEqual(repository.list(), []);
    }
    repository.create(course);
    assert.throws(() => repository.create({ ...course, title: 'Replacement' }),
      (error) => error instanceof CourseError && error.code === 'duplicate-id');
    assert.deepEqual(repository.list(), [course]);
    database.exec(`CREATE TRIGGER reject_course BEFORE INSERT ON courses
      BEGIN SELECT RAISE(ABORT, 'test storage failure'); END;`);
    const service = new CourseService(repository,
      () => 'course-00000000-0000-4000-8000-000000000002', () => new Date());
    assert.throws(() => service.createCourse({ title: 'Other', mode: 'hybrid', objective: 'Goal' }),
      (error) => error instanceof CourseError && error.code === 'storage');
    assert.deepEqual(repository.list(), [course]);
  } finally { database.close(); }
});
