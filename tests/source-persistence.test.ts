import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyMigrations, migrations } from '../src/persistence/migrations.ts';
import { openLearningDatabase } from '../src/persistence/database.ts';
import { CourseService } from '../src/services/course-service.ts';
import { SourceService } from '../src/services/source-service.ts';
import { ProjectSourceReader } from '../src/ingestion/input-reader.ts';
import { TextParser } from '../src/ingestion/text-parser.ts';

test('SQLite directly rejects malformed source IDs and blank identities without the service', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys = OFF');
    applyMigrations(database);
    const insert = database.prepare(`INSERT INTO sources
      (id, course_id, identity_key, kind, title, origin, current_version, status, created_at, updated_at)
      VALUES (?, ?, ?, 'text', 'Fixture', 'learner_file', 1, 'ready', 'now', 'now')`);
    const valid = 'source-abcdef01-2345-4567-89ab-0123456789ab';
    for (const id of ['../unsafe', 'source-short', valid.toUpperCase(),
      valid.replace('4567', '5567'), valid.replace('89ab', '79ab'), valid.replace('abcdef01', '-bcdef01'),
      valid.replace('abcdef01', 'gbcdef01')]) {
      assert.throws(() => insert.run(id, 'fixture-course', 'sources/inbox/logic.txt'), /CHECK constraint failed/);
    }
    for (const identity of ['', '   ']) {
      assert.throws(() => insert.run(valid, 'fixture-course', identity), /CHECK constraint failed/);
    }
    // Foreign keys are deliberately off in this direct constraint test: valid ID/identity must pass the CHECKs.
    insert.run(valid, 'fixture-course', 'sources/inbox/logic.txt');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sources').get()?.count, 1);
  } finally { database.close(); }
});

test('M1 checkpoint upgrades additively with unchanged migration checksums, ledger rows and courses', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const historical = ['7f4effbc7084f5e36165e0e1dcfa0211b38dabb3c9cf31096af50748a27309d5',
      '323a20a932860ca7827e4a3ee4c68bcf5d331ec69f4dc30fdcad0debdcb24c51'];
    migrations.slice(0, 2).forEach((m, index) => assert.equal(createHash('sha256')
      .update(JSON.stringify([m.version, m.name, m.sql])).digest('hex'), historical[index]));
    applyMigrations(database, migrations.slice(0, 2));
    database.prepare('INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?)')
      .run('course-00000000-0000-4000-8000-000000000001', 'Historical M1', 'source_grounded', 'Study', 'earlier', 'earlier');
    const ledger = database.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    const courses = database.prepare('SELECT * FROM courses').all();
    applyMigrations(database);
    applyMigrations(database);
    assert.deepEqual(database.prepare('SELECT * FROM schema_migrations WHERE version <= 2 ORDER BY version').all(), ledger);
    assert.deepEqual(database.prepare('SELECT * FROM courses').all(), courses);
    assert.deepEqual(database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version), migrations.map((migration) => migration.version));
  } finally { database.close(); }
});
test('real file ingestion survives restart with historical text and FTS; unchanged ingestion stays at the same version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'learning-m2-restart-'));
  let store = openLearningDatabase(root);
  const makeServices = () => {
    const courses = new CourseService(store.courses, () => `course-${randomUUID()}`, () => new Date());
    const sources = new SourceService(courses, store.sources, new ProjectSourceReader(root), [new TextParser()],
      (bytes) => createHash('sha256').update(bytes).digest('hex'), () => `source-${randomUUID()}`);
    return { courses, sources };
  };
  try {
    mkdirSync(join(root, 'sources'), { recursive: true });
    const path = join(root, 'sources', 'fixture.txt');
    writeFileSync(path, 'Implication version one');
    const first = makeServices();
    const course = first.courses.createCourse({ title: 'Logic', mode: 'source_grounded', objective: 'Study' });
    const source = await first.sources.ingest(course.id, { location: path });
    writeFileSync(path, 'Equivalence version two');
    const changed = await first.sources.ingest(course.id, { location: path });
    assert.equal(changed.version.version, 2);
    store.close();
    store = openLearningDatabase(root);
    const reopened = makeServices();
    assert.equal(reopened.sources.list(course.id)[0]!.id, source.source.id);
    assert.equal(reopened.sources.status(course.id, source.source.id, 1).segments[0]!.text, 'Implication version one');
    assert.equal(reopened.sources.status(course.id, source.source.id).version, 2);
    assert.equal(reopened.sources.search(course.id, 'Equivalence')[0]!.segment.version, 2);
    const same = await reopened.sources.ingest(course.id, { location: path });
    assert.equal(same.unchanged, true);
    assert.equal(same.version.version, 2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
