import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { migrations, applyMigrations } from '../src/persistence/migrations.ts';
import { SqliteFoundationStore } from '../src/persistence/database.ts';
import { services, ids, hash, human } from './helpers/assessment-fixtures.ts';
import { LearnerStateService } from '../src/services/learner-state-service.ts';
test('migration 9 upgrades populated M7 with M4/M5/M6/M7 audit and all eight historical checksums intact', async () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('PRAGMA foreign_keys=ON');
        applyMigrations(db, migrations.slice(0, 8));
        const store = new SqliteFoundationStore(db);
        const { course, sourceId, sourceVersion, proposal, now } = await import('./helpers/graph-fixtures.ts');
        store.courses.create(course);
        store.sources.save({ proposedId: sourceId, courseId: course.id, identityKey: 'synthetic.md', kind: 'text', origin: 'learner_file', location: 'synthetic.md', ingestedAt: now, contentHash: sourceVersion.contentHash, document: sourceVersion });
        const runtime = services(store);
        const graph = runtime.graphs.createDraft(course.id, proposal());
        runtime.graphs.activate(course.id, graph.version);
        const f = { db, store, ...runtime, courseId: course.id, graph };
        const { diagnostics, syntheticGenerator, answer } = await import('./helpers/diagnostic-fixtures.ts');
        const { DeterministicEvaluator } = await import('../src/evaluation/deterministic.ts');
        const d = diagnostics(f);
        const diagnostic = d.start(course.id, 1);
        const probe = (await d.next(course.id, syntheticGenerator)).probe!;
        await d.submit(course.id, probe.id, answer(), new DeterministicEvaluator());
        await d.next(course.id, syntheticGenerator);
        const { TeachingService } = await import('../src/services/teaching-service.ts');
        const { TeachingContextBuilder } = await import('../src/services/teaching-context.ts');
        const { proposal: content } = await import('./helpers/teaching-fixtures.ts');
        const teaching = new TeachingService(store.teaching, store.diagnostics, store.assessments, runtime.graphs, runtime.assessments, runtime.evaluations, new TeachingContextBuilder(store.sources, store.research), ids, () => new Date(now));
        const session = teaching.start(course.id);
        const move = (await teaching.next(course.id, { propose: async (c) => content(c) })).move!;
        await teaching.answer(course.id, move.id, { response: 'alpha' }, new DeterministicEvaluator());
        teaching.abandon(course.id);
        const audit = runtime.evidence.recent(course.id)[0]!;
        runtime.evaluations.record(course.id, audit.attempt.id, 'synthetic-upgrade-gap', human, { status: 'scored', correctness: 0, rubricScores: {}, rationale: 'Synthetic upgrade gap' }, audit.evaluation.id);
        const state = new LearnerStateService(store.learnerState, store.learnerLedger, runtime.graphs, ids, hash, () => new Date(now));
        const revision = state.refresh(course.id);
        assert(revision.gaps.some(g => g.status === 'OPEN'));
        const oldState = JSON.stringify(state.history(course.id));
        const before = db.prepare('SELECT * FROM schema_migrations').all();
        const prior = JSON.stringify({ diagnostic: d.audit(course.id, diagnostic.id), teaching: teaching.audit(course.id, session.id), evidence: runtime.evidence.recent(course.id) });
        assert.equal(before[6]!.checksum, '667e956729f5eea4a1da52334b88e4ea4d9e2c3540dd99d30ff1126c036de244');
        applyMigrations(db);
        assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=8').all(), before);
        assert.equal(JSON.stringify({ diagnostic: d.audit(course.id, diagnostic.id), teaching: teaching.audit(course.id, session.id), evidence: runtime.evidence.recent(course.id) }), prior);
        assert.equal(store.readStatus().schemaVersion, 9);
        assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
        assert.equal(JSON.stringify(state.history(course.id)), oldState);
        assert.equal(state.refresh(course.id).id, revision.id);
        assert.equal(before.length, 8);
        assert.equal(before[7]!.checksum, 'a788525a2566f16fdcf8bb9f907f79e92217ae8100fd5397d6b25b144278ebb9');
        for (const [index, row] of before.entries())
            assert.equal(createHash('sha256').update(JSON.stringify([migrations[index]!.version, migrations[index]!.name, migrations[index]!.sql])).digest('hex'), row.checksum);
    }
    finally {
        db.close();
    }
});
