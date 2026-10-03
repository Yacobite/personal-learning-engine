import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyMigrations, migrations } from '../src/persistence/migrations.ts';
import { SqliteFoundationStore, openLearningDatabase } from '../src/persistence/database.ts';
import { CourseService } from '../src/services/course-service.ts';
import { GraphService } from '../src/services/graph-service.ts';
import { proposal, sourceId, sourceVersion } from './helpers/graph-fixtures.ts';
function setup(db: DatabaseSync) {
    db.exec('PRAGMA foreign_keys=ON');
    applyMigrations(db);
    const store = new SqliteFoundationStore(db);
    const courses = new CourseService(store.courses, () => `course-${randomUUID()}`, () => new Date());
    const course = courses.createCourse({ title: 'Synthetic', mode: 'source_grounded', objective: 'Fixture' });
    store.sources.save({ proposedId: sourceId, courseId: course.id, identityKey: 'fixture', kind: 'text', origin: 'learner_file', location: 'fixture', ingestedAt: sourceVersion.ingestedAt, contentHash: sourceVersion.contentHash, document: sourceVersion });
    const graphs = new GraphService(courses, store.graphs, store.sources, store.research, () => `concept-${randomUUID()}`, () => new Date());
    return { store, courses, course, graphs };
}
test('migration 4 preserves M2 ledger checksums and existing source history', () => {
    const db = new DatabaseSync(':memory:');
    try {
        applyMigrations(db, migrations.slice(0, 3));
        const before = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
        applyMigrations(db);
        assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=3 ORDER BY version').all(), before);
        assert.equal(migrations[3]!.version, 4);
        assert.equal(createHash('sha256').update(JSON.stringify([migrations[0]!.version, migrations[0]!.name, migrations[0]!.sql])).digest('hex'), '7f4effbc7084f5e36165e0e1dcfa0211b38dabb3c9cf31096af50748a27309d5');
    }
    finally {
        db.close();
    }
});
test('mid-write concept, edge and activation failures rollback all partial changes', () => {
    const db = new DatabaseSync(':memory:');
    const { graphs, course, store } = setup(db);
    try {
        const first = graphs.createDraft(course.id, proposal());
        graphs.activate(course.id, 1);
        for (const table of ['concepts', 'curriculum_edges']) {
            db.exec(`CREATE TRIGGER injected_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END;`);
            assert.throws(() => graphs.createDraft(course.id, proposal()), /preserved/);
            db.exec('DROP TRIGGER injected_failure');
            assert.equal(store.graphs.list(course.id).length, 1);
            assert.equal(db.prepare('SELECT COUNT(*) AS n FROM concepts').get()!.n, 2);
            assert.equal(db.prepare('SELECT COUNT(*) AS n FROM curriculum_edges').get()!.n, 1);
        }
        const second = graphs.createDraft(course.id, { ...proposal(), nodes: proposal().nodes.map((node, index) => ({ ...node, conceptId: first.nodes.find((item) => item.title === `Synthetic ${index ? 'b' : 'a'}`)!.conceptId })) });
        db.exec("CREATE TRIGGER activation_failure BEFORE UPDATE ON course_curriculum_current BEGIN SELECT RAISE(ABORT,'injected'); END;");
        assert.throws(() => graphs.activate(course.id, second.version));
        assert.equal(graphs.current(course.id), 1);
        assert.equal(graphs.get(course.id, 2).activatedAt, null);
    }
    finally {
        store.close();
    }
});
test('SQLite foreign keys reject cross-course concepts and inconsistent exact segment references', () => {
    const db = new DatabaseSync(':memory:');
    const { graphs, course, store } = setup(db);
    try {
        const first = graphs.createDraft(course.id, proposal());
        assert.throws(() => db.prepare('UPDATE node_source_provenance SET source_version=2 WHERE course_id=?').run(course.id), /FOREIGN KEY/);
        const other = `course-${randomUUID()}`;
        db.prepare('INSERT INTO courses VALUES (?,?,?,?,?,?)').run(other, 'Other', 'source_grounded', 'Goal', 'now', 'now');
        db.prepare('INSERT INTO curriculum_versions VALUES (?,?,?,?,?,?)').run(other, 1, 'now', null, 'fixture', '[]');
        assert.throws(() => graphs.createDraft(other, proposal()), /this course/);
        assert.throws(() => db.prepare('INSERT INTO curriculum_nodes VALUES (?,?,?,?,?,?)').run(other, 1, first.nodes[0]!.conceptId, 'Other', 'concept', 'Wrong owner'), /FOREIGN KEY/);
    }
    finally {
        store.close();
    }
});
test('restart preserves active pointer, immutable history and exact old source provenance', () => {
    const root = mkdtempSync(join(tmpdir(), 'learning-m3-restart-'));
    let store = openLearningDatabase(root);
    try {
        const courses = new CourseService(store.courses, () => `course-${randomUUID()}`, () => new Date());
        const course = courses.createCourse({ title: 'Fixture', mode: 'source_grounded', objective: 'Fixture' });
        store.sources.save({ proposedId: sourceId, courseId: course.id, identityKey: 'fixture', kind: 'text', origin: 'learner_file', location: 'fixture', ingestedAt: sourceVersion.ingestedAt, contentHash: sourceVersion.contentHash, document: sourceVersion });
        const graphs = new GraphService(courses, store.graphs, store.sources, store.research, () => `concept-${randomUUID()}`, () => new Date());
        const first = graphs.createDraft(course.id, proposal());
        graphs.activate(course.id, 1);
        store.sources.save({ proposedId: sourceId, courseId: course.id, identityKey: 'fixture', kind: 'text', origin: 'learner_file', location: 'fixture', ingestedAt: sourceVersion.ingestedAt, contentHash: 'c'.repeat(64), document: { ...sourceVersion, segments: [{ ...sourceVersion.segments[0]!, text: 'New evidence' }] } });
        const old = graphs.get(course.id, 1);
        store.close();
        store = openLearningDatabase(root);
        assert.equal(store.graphs.current(course.id), 1);
        assert.deepEqual(store.graphs.get(course.id, 1), old);
        assert.equal(store.graphs.get(course.id, 1)!.nodes[0]!.sourceRefs[0]!.version, 1);
        assert.equal(store.sources.getVersion(course.id, sourceId, 1)!.segments[0]!.text, sourceVersion.segments[0]!.text);
        assert.equal(first.version, 1);
    }
    finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
    }
});
