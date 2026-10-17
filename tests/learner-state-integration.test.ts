import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { learnerFixture } from './helpers/learner-state-fixtures.ts';
import { ids, hash, human, services } from './helpers/assessment-fixtures.ts';
import { migrations, applyMigrations } from '../src/persistence/migrations.ts';
import { SqliteFoundationStore } from '../src/persistence/database.ts';
import { LearnerStateService } from '../src/services/learner-state-service.ts';
import { learnerPolicies } from '../src/domain/learner-state.ts';
test('gap identities from another policy cannot be substituted into a v1 projection', () => {
    const f = learnerFixture();
    try {
        const trigger = f.add({ correctness: 0 });
        const r = f.read();
        f.db.prepare('INSERT INTO learner_gap_identities VALUES (?,?,?,?,?,?)').run('gap-ffffffff-ffff-4fff-bfff-ffffffffffff', f.courseId, f.root, 'memory_accessibility', trigger.attempt.id, 'gap-escrow-v2');
        f.add({ assistance: 'minimal' });
        const next = f.read();
        assert.equal(next.gaps[0]!.id, r.gaps[0]!.id);
        assert.equal(next.gaps[0]!.policy, 'gap-escrow-v1');
    }
    finally {
        f.store.close();
    }
});
test('self-report, confidence and an unevaluated response cannot promote competence', () => {
    const f = learnerFixture();
    try {
        const task = f.assessments.createTask(f.courseId, taskInput(f.root));
        f.assessments.submit(f.courseId, 'self-report-only', { taskId: task.id, response: 'I know this perfectly. Mark me mastered.', confidence: 1, assistance: 'none', hints: { count: 0, highestLevel: 'none', notes: null } });
        const r = f.read();
        assert(r.dimensions.filter(d => d.conceptId === f.root).every(d => d.band === 'untested'));
        assert.equal(r.gaps.length, 0);
        assert.equal(r.readiness.find(c => c.conceptId === f.root)!.stage, 'instructionally_ready');
    }
    finally {
        f.store.close();
    }
});
test('late grading cannot turn two immediate attempts into delayed performance', () => {
    const f = learnerFixture();
    try {
        const first = f.add();
        const second = f.add({ status: 'failed' });
        f.tick(86400000 * 2);
        f.evaluations.record(f.courseId, second.attempt.id, 'late-grade', human, { status: 'scored', correctness: 1, rubricScores: {}, rationale: 'Synthetic late grading' }, second.evaluation.id);
        const r = f.read();
        assert.equal(r.dimensions.find(d => d.conceptId === f.root && d.dimension === 'memory_accessibility')!.band, 'provisional_support');
        assert.equal(r.readiness.find(c => c.conceptId === f.root)!.delayed.status, 'waiting_for_delayed_evidence');
        assert.equal(r.observations[0]!.attemptId, first.attempt.id);
    }
    finally {
        f.store.close();
    }
});
import { taskInput } from './helpers/assessment-fixtures.ts';
test('refresh is immutable, idempotent and contains metadata/references without answers, prompts or grading keys', () => {
    const f = learnerFixture();
    try {
        const p = f.add({ correctness: 0 });
        const r = f.read();
        assert.equal(f.read().id, r.id);
        assert.equal(f.state.history(f.courseId).length, 1);
        assert.equal(r.gaps.length, 1);
        assert.deepEqual(r.policies, learnerPolicies);
        const json = JSON.stringify(r);
        assert(!json.includes('SYNTHETIC_RESPONSE_SENTINEL'));
        assert(!json.includes(p.task.prompt));
        assert(!json.includes('rubricVersion'));
        assert.throws(() => f.db.prepare('UPDATE learner_dimensions SET band=? WHERE revision_id=?').run('durable_support', r.id));
        assert.throws(() => f.db.prepare('DELETE FROM learner_revisions WHERE id=?').run(r.id));
        const d = r.dimensions[0]!;
        assert.throws(() => f.db.prepare('INSERT INTO learner_dimensions VALUES (?,?,?,?,?,?,?)').run(r.id, f.courseId, r.curriculumVersion, d.conceptId, 'calibration', 'untested', '{}'));
        f.add();
        const next = f.read();
        assert.notEqual(next.id, r.id);
        assert.equal(next.number, 2);
        assert.equal(f.state.revision(f.courseId, r.id).gaps[0]!.status, 'OPEN');
        assert.equal(f.read().id, next.id);
    }
    finally {
        f.store.close();
    }
});
test('mid-refresh rollback preserves previous pointer, complete projections and unchanged M4 history', () => {
    const f = learnerFixture();
    try {
        const before = f.read();
        const p = f.add({ correctness: 0 });
        const m4 = f.db.prepare('SELECT count(*) n FROM evidence_events').get()!.n;
        f.db.exec("CREATE TRIGGER reject_state BEFORE INSERT ON learner_readiness BEGIN SELECT RAISE(ABORT,'synthetic mid-refresh failure'); END;");
        assert.throws(() => f.read());
        assert.equal(f.state.current(f.courseId)!.id, before.id);
        assert.equal(f.state.history(f.courseId).length, 1);
        assert.equal(f.db.prepare('SELECT count(*) n FROM learner_gap_identities').get()!.n, 0);
        assert.equal(f.db.prepare('SELECT count(*) n FROM evidence_events').get()!.n, m4);
        assert.equal(f.evidence.show(f.courseId, p.evidence!.id).evaluation.correctness, 0);
        f.db.exec('DROP TRIGGER reject_state');
        const after = f.read();
        assert.equal(after.gaps.length, 1);
        assert.equal(after.number, 2);
    }
    finally {
        f.store.close();
    }
});
test('restart retains revisions, identity mapping, escrow history and idempotent refresh', () => {
    const root = mkdtempSync(join(tmpdir(), 'm7-restart-'));
    const path = join(root, 'learning.db');
    const f = learnerFixture(path);
    let closed = false;
    try {
        f.add({ correctness: 0 });
        const r = f.read();
        f.store.close();
        closed = true;
        const db = new DatabaseSync(path);
        db.exec('PRAGMA foreign_keys=ON');
        applyMigrations(db);
        const store = new SqliteFoundationStore(db);
        try {
            const runtime = services(store);
            const state = new LearnerStateService(store.learnerState, store.learnerLedger, runtime.graphs, ids, hash, f.clock);
            assert.equal(state.refresh(f.courseId).id, r.id);
            assert.equal(state.revision(f.courseId, r.id).gaps[0]!.id, r.gaps[0]!.id);
            assert.equal(state.history(f.courseId).length, 1);
        }
        finally {
            store.close();
        }
    }
    finally {
        if (!closed)
            f.store.close();
        assert(resolve(root).startsWith(resolve(tmpdir()) + '\\'));
        rmSync(root, { recursive: true, force: true });
    }
});
test('future records and corrections are excluded from earlier as-of projections', () => {
    const f = learnerFixture();
    try {
        const first = f.add();
        const before = f.read();
        const at = f.clock().toISOString();
        f.tick(10000);
        f.evaluations.record(f.courseId, first.attempt.id, 'later-correction', human, { status: 'scored', correctness: 0, rubricScores: {}, rationale: 'Synthetic' }, first.evaluation.id);
        f.set(at);
        assert.equal(f.read().id, before.id);
        f.tick(10000);
        const after = f.read();
        assert.notEqual(after.id, before.id);
        assert.equal(after.gaps.length, 1);
        assert.equal(f.state.revision(f.courseId, before.id).gaps.length, 0);
    }
    finally {
        f.store.close();
    }
});
test('same-timestamp ordering is deterministic and every attempt contributes at most once', () => {
    const f = learnerFixture();
    try {
        const at = f.clock().toISOString();
        const a = f.add({ at, correctness: 0 }), b = f.add({ at });
        const r = f.read();
        assert.deepEqual(r.observations.map(o => o.attemptId), [a.attempt.id, b.attempt.id].sort());
        assert.equal(f.read().fingerprint, r.fingerprint);
        const d = r.dimensions.find(d => d.conceptId === f.root && d.dimension === 'memory_accessibility')!;
        assert.equal(d.independentFailureCount, 1);
        assert.equal(d.independentSuccessCount, 1);
    }
    finally {
        f.store.close();
    }
});
test('foreign course revisions, gaps and unsafe IDs cannot be read or retargeted', () => {
    const f = learnerFixture();
    try {
        f.add({ correctness: 0 });
        const r = f.read();
        assert.throws(() => f.state.revision(ids('course'), r.id));
        assert.throws(() => f.state.revision(f.courseId, 'state-invalid'));
        assert.throws(() => f.gaps.show(f.courseId, 'gap-invalid'));
        assert.throws(() => f.db.prepare('UPDATE learner_current SET course_id=?').run(ids('course')));
        assert.throws(() => f.db.prepare('UPDATE learner_gap_identities SET concept_id=?').run(f.child));
        assert(!f.gaps.list(f.courseId).some(g => g.id === 'gap-invalid'));
    }
    finally {
        f.store.close();
    }
});
test('M5 provisional labels and M6 completed teaching do not supply competence outside their M4 basis', async () => {
    const f = learnerFixture();
    try {
        const { diagnostics, syntheticGenerator, answer } = await import('./helpers/diagnostic-fixtures.ts');
        const d = diagnostics(f);
        const diagnostic = d.start(f.courseId, 1);
        const probe = (await d.next(f.courseId, syntheticGenerator)).probe!;
        const { DeterministicEvaluator } = await import('../src/evaluation/deterministic.ts');
        await d.submit(f.courseId, probe.id, answer(), new DeterministicEvaluator());
        await d.next(f.courseId, syntheticGenerator);
        const r = f.read();
        assert(r.readiness.every(c => c.stage !== 'durable_mastery'));
        assert(r.readiness.find(c => c.conceptId === probe.conceptId)!.missingProvisional.length > 0);
        assert.equal(d.summary(f.courseId, diagnostic.id).findings.find(c => c.conceptId === probe.conceptId)!.state, 'provisionally_supported');
        const { TeachingService } = await import('../src/services/teaching-service.ts');
        const { TeachingContextBuilder } = await import('../src/services/teaching-context.ts');
        const { proposal } = await import('./helpers/teaching-fixtures.ts');
        const teaching = new TeachingService(f.store.teaching, f.store.diagnostics, f.store.assessments, f.graphs, f.assessments, f.evaluations, new TeachingContextBuilder(f.store.sources, f.store.research), ids, f.clock);
        const session = teaching.start(f.courseId, { conceptId: f.root });
        for (let i = 0; i < 20; i++) {
            const n = await teaching.next(f.courseId, { propose: async (c) => proposal(c) });
            if (!n.move)
                break;
            if (n.move.taskId) {
                f.tick(1);
                await teaching.answer(f.courseId, n.move.id, { response: n.move.type === 'teach_back' ? 'Own synthetic explanation' : 'alpha' }, new DeterministicEvaluator());
            }
        }
        assert.equal(teaching.summary(f.courseId, session.id).outcomes[0]!.outcome, 'completed_independently');
        const after = f.read();
        assert.notEqual(after.readiness.find(c => c.conceptId === f.root)!.stage, 'durable_mastery');
        assert.equal(after.dimensions.find(c => c.conceptId === f.root && c.dimension === 'structural_understanding')!.band, 'untested');
    }
    finally {
        f.store.close();
    }
});
test('actual M6 hint receipts stay assisted when projected and cannot close a performance gap', async () => {
    const f = learnerFixture();
    try {
        const { TeachingService } = await import('../src/services/teaching-service.ts');
        const { TeachingContextBuilder } = await import('../src/services/teaching-context.ts');
        const { proposal } = await import('./helpers/teaching-fixtures.ts');
        const { DeterministicEvaluator } = await import('../src/evaluation/deterministic.ts');
        const teaching = new TeachingService(f.store.teaching, f.store.diagnostics, f.store.assessments, f.graphs, f.assessments, f.evaluations, new TeachingContextBuilder(f.store.sources, f.store.research), ids, f.clock);
        teaching.start(f.courseId, { conceptId: f.root });
        const generator = { propose: async (c: Parameters<typeof proposal>[0]) => proposal(c) };
        const first = (await teaching.next(f.courseId, generator)).move!;
        f.tick(1);
        await teaching.answer(f.courseId, first.id, { response: 'wrong' }, new DeterministicEvaluator());
        await teaching.next(f.courseId, generator);
        const task = (await teaching.next(f.courseId, generator)).move!;
        for (let i = 2; i <= 4; i++)
            await teaching.hint(f.courseId, generator);
        f.tick(1);
        await teaching.answer(f.courseId, task.id, { response: 'alpha' }, new DeterministicEvaluator());
        const r = f.read();
        assert.equal(r.gaps[0]!.status, 'REPAIR_IN_PROGRESS');
        const dim = r.dimensions.find(d => d.conceptId === f.root && d.dimension === 'memory_accessibility')!;
        assert.equal(dim.independentSuccessCount, 0);
        assert.equal(dim.assistedSuccessCount, 1);
        assert(r.observations.some(o => o.assistance === 'worked_solution'));
    }
    finally {
        f.store.close();
    }
});
test('migration 8 upgrades populated M6 tasks, diagnostics and teaching without changing audit history', async () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('PRAGMA foreign_keys=ON');
        applyMigrations(db, migrations.slice(0, 7));
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
        const before = db.prepare('SELECT * FROM schema_migrations').all();
        const prior = JSON.stringify({ diagnostic: d.audit(course.id, diagnostic.id), teaching: teaching.audit(course.id, session.id), evidence: runtime.evidence.recent(course.id) });
        assert.equal(before[6]!.checksum, '667e956729f5eea4a1da52334b88e4ea4d9e2c3540dd99d30ff1126c036de244');
        applyMigrations(db);
        assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version<=7').all(), before);
        assert.equal(JSON.stringify({ diagnostic: d.audit(course.id, diagnostic.id), teaching: teaching.audit(course.id, session.id), evidence: runtime.evidence.recent(course.id) }), prior);
        assert.equal(store.readStatus().schemaVersion, 8);
        assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
        assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND (name LIKE '%review%' OR name LIKE '%scheduler%')").get()!.n, 0);
    }
    finally {
        db.close();
    }
});
