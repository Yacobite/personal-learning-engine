import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewFixture, day } from './helpers/review-fixtures.ts';
import { ids, hash } from './helpers/assessment-fixtures.ts';
import { ReviewService } from '../src/services/review-service.ts';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import { services } from './helpers/assessment-fixtures.ts';
import { LearnerStateService } from '../src/services/learner-state-service.ts';
import { TeachingContextBuilder } from '../src/services/teaching-context.ts';
const evaluator = new DeterministicEvaluator();
test('M7 refresh failure preserves M4 evidence and review link; next refresh safely schedules', async () => {
    const f = reviewFixture();
    try {
        f.support();
        f.set(f.reviews.queue(f.courseId).upcoming[0]!.dueAt);
        const n = await f.reviews.next(f.courseId, f.generator);
        const broken = new ReviewService(f.store.reviews, f.store.assessments, f.graphs, f.assessments, f.evaluations, { competenceTimeline: f.state.competenceTimeline.bind(f.state), refresh: () => { throw Error('M7 injected'); } }, f.context, () => ids('review'), hash, f.clock);
        await assert.rejects(broken.answer(f.courseId, n.item!.id, { response: 'alpha' }, evaluator), /M7 injected/);
        const i = f.reviews.get(f.courseId, n.item!.id);
        assert.equal(i.status, 'completed');
        assert.equal(f.store.assessments.evidenceForAttempt(f.courseId, i.attemptId!).length, 1);
        assert.equal(f.store.reviews.list(f.courseId).filter(i => i.status === 'scheduled').length, 0);
        const next = f.reviews.queue(f.courseId).upcoming[0]!;
        assert.equal(next.kind, 'maintenance');
        f.reviews.queue(f.courseId);
        assert.equal(f.store.reviews.list(f.courseId).filter(i => i.status === 'scheduled').length, 1);
    }
    finally {
        f.store.close();
    }
});
test('schedule failure rolls back supersession and partial items; M7 and M4 survive', () => {
    const f = reviewFixture();
    try {
        f.support();
        const old = f.store.reviews.list(f.courseId)[0]!;
        f.set(old.dueAt);
        f.add();
        f.db.exec("CREATE TRIGGER injected_review BEFORE INSERT ON review_progress BEGIN SELECT RAISE(ABORT,'injected');END;");
        assert.throws(() => f.reviews.refresh(f.courseId), /injected/);
        assert.equal(f.reviews.get(f.courseId, old.id).status, 'scheduled');
        assert.equal(f.store.reviews.list(f.courseId).length, 1);
        assert.equal(f.read().readiness.find(r => r.conceptId === f.root)!.stage, 'durable_mastery');
        f.db.exec('DROP TRIGGER injected_review');
        f.reviews.refresh(f.courseId);
        assert.equal(f.reviews.get(f.courseId, old.id).status, 'superseded');
        assert.equal(f.store.reviews.list(f.courseId).filter(i => i.status === 'scheduled').length, 1);
    }
    finally {
        f.store.close();
    }
});
test('M4 task plus review link rollback together; concurrency generates one active immutable task', async () => {
    const f = reviewFixture();
    try {
        f.support();
        f.set(f.reviews.queue(f.courseId).upcoming[0]!.dueAt);
        const before = Number(f.db.prepare('SELECT count(*) n FROM assessment_tasks').get()!.n);
        f.db.exec("CREATE TRIGGER injected_link BEFORE UPDATE ON review_progress WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT,'link failure');END;");
        await assert.rejects(f.reviews.next(f.courseId, f.generator), /link failure/);
        assert.equal(Number(f.db.prepare('SELECT count(*) n FROM assessment_tasks').get()!.n), before);
        assert.equal(Number(f.db.prepare('SELECT count(*) n FROM review_task_origins').get()!.n), 0);
        f.db.exec('DROP TRIGGER injected_link');
        const [a, b] = await Promise.all([f.reviews.next(f.courseId, f.generator), f.reviews.next(f.courseId, f.generator)]);
        assert.equal(a.item!.id, b.item!.id);
        assert.equal(a.item!.taskId, b.item!.taskId);
        assert.equal(Number(f.db.prepare('SELECT count(*) n FROM assessment_tasks').get()!.n), before + 1);
    }
    finally {
        f.store.close();
    }
});
test('post-attempt link failure recovers the same M4 operation without duplicate response', async () => {
    const f = reviewFixture();
    try {
        f.support();
        f.set(f.reviews.queue(f.courseId).upcoming[0]!.dueAt);
        const n = await f.reviews.next(f.courseId, f.generator);
        f.db.exec("CREATE TRIGGER injected_attempt BEFORE UPDATE ON review_progress WHEN NEW.status='awaiting_evaluation' BEGIN SELECT RAISE(ABORT,'attempt link');END;");
        await assert.rejects(f.reviews.answer(f.courseId, n.item!.id, { response: 'alpha' }, evaluator), /attempt link/);
        const attempt = f.store.assessments.attemptOperation(f.courseId, 'review:' + n.item!.id)!;
        assert(attempt);
        f.db.exec('DROP TRIGGER injected_attempt');
        f.reviews.refresh(f.courseId);
        assert.equal(f.reviews.get(f.courseId, n.item!.id).attemptId, attempt.id);
        await f.reviews.retryEvaluation(f.courseId, n.item!.id, evaluator);
        assert.equal(f.reviews.get(f.courseId, n.item!.id).attemptId, attempt.id);
    }
    finally {
        f.store.close();
    }
});
test('restart resumes active task and persisted schedule; clock advancement alone creates no evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'm8-restart-')), path = join(root, 'learning.db');
    const f = reviewFixture(path);
    let closed = false;
    try {
        f.support();
        const i = f.reviews.queue(f.courseId).upcoming[0]!;
        f.set(i.dueAt);
        const n = await f.reviews.next(f.courseId, f.generator);
        const count = f.db.prepare('SELECT count(*) n FROM evidence_events').get()!.n;
        f.store.close();
        closed = true;
        // openLearningDatabase normally uses _learning; directly reopen the explicit fixture database.
        const { DatabaseSync } = await import('node:sqlite');
        const { SqliteFoundationStore } = await import('../src/persistence/database.ts');
        const db = new DatabaseSync(path);
        db.exec('PRAGMA foreign_keys=ON');
        const store = new SqliteFoundationStore(db);
        try {
            const r = services(store), clock = () => new Date(Date.parse(i.dueAt) + 365 * day);
            const state = new LearnerStateService(store.learnerState, store.learnerLedger, r.graphs, ids, hash, clock);
            const s = new ReviewService(store.reviews, store.assessments, r.graphs, r.assessments, r.evaluations, state, new TeachingContextBuilder(store.sources, store.research), () => ids('review'), hash, clock);
            const resumed = await s.next(f.courseId, { propose: async () => { throw Error('must resume'); } });
            assert.equal(resumed.item!.taskId, n.item!.taskId);
            assert.equal(db.prepare('SELECT count(*) n FROM evidence_events').get()!.n, count);
        }
        finally {
            store.close();
        }
    }
    finally {
        if (!closed)
            f.store.close();
        rmSync(root, { recursive: true, force: true });
    }
});
test('unavailable highest-priority grounded context falls through; all-unavailable reports cleanly', async () => {
    const f = reviewFixture();
    try {
        f.support(f.root);
        f.support(f.child);
        const due = f.store.reviews.list(f.courseId).map(i => i.dueAt).sort().at(-1)!;
        f.set(due);
        const absent = new ReviewService(f.store.reviews, f.store.assessments, f.graphs, f.assessments, f.evaluations, f.state, { tryBuild: () => undefined }, () => ids('review'), hash, f.clock);
        const result = await absent.next(f.courseId, f.generator);
        assert.equal(result.reason, 'no_evaluable_review_task');
        assert.equal(result.item, null);
        const count = f.store.reviews.list(f.courseId).length;
        absent.refresh(f.courseId);
        assert.equal(f.store.reviews.list(f.courseId).length, count);
    }
    finally {
        f.store.close();
    }
    const g = reviewFixture();
    try {
        g.support(g.root);
        g.support(g.child);
        g.set(g.store.reviews.list(g.courseId).map(i => i.dueAt).sort().at(-1)!);
        const ordered = g.reviews.queue(g.courseId).due, unavailable = ordered[0]!.conceptId;
        const s = new ReviewService(g.store.reviews, g.store.assessments, g.graphs, g.assessments, g.evaluations, g.state, { tryBuild: (graph, id, n) => id === unavailable ? undefined : g.context.tryBuild(graph, id, n) }, () => ids('review'), hash, g.clock);
        const n = await s.next(g.courseId, g.generator);
        assert(n.item);
        assert.notEqual(n.item.conceptId, unavailable);
    }
    finally {
        g.store.close();
    }
});
test('unscored review remains M4 history and gets an independent retry without spacing advance', async () => {
    const f = reviewFixture();
    try {
        f.durable();
        f.set(f.reviews.queue(f.courseId).upcoming[0]!.dueAt);
        const n = await f.reviews.next(f.courseId, f.generator);
        const r = await f.reviews.answer(f.courseId, n.item!.id, { response: 'alpha' }, { identity: evaluator.identity, evaluate: async () => ({ status: 'unscored', correctness: null, rubricScores: {}, rationale: 'Synthetic evaluator cannot score' }) });
        assert.equal(r.outcome, 'unscored');
        const next = f.reviews.queue(f.courseId).upcoming[0]!;
        assert.equal(next.stage, 0);
        assert.equal(Date.parse(next.dueAt) - f.clock().getTime(), day);
    }
    finally {
        f.store.close();
    }
});
test('SQLite preserves review history, rejects foreign links and cannot reinterpret existing performance origins', async () => {
    const f = reviewFixture();
    try {
        f.support();
        const i = f.store.reviews.list(f.courseId)[0]!;
        assert.throws(() => f.db.prepare('UPDATE review_items SET stage=4 WHERE id=?').run(i.id), /immutable/);
        assert.throws(() => f.db.prepare('DELETE FROM review_items WHERE id=?').run(i.id), /immutable|FOREIGN/);
        const original = f.read().observations[0]!;
        assert.throws(() => f.db.prepare("INSERT INTO review_task_origins VALUES (?,?,'review_generated')").run(original.taskId, f.courseId), /existing performance/);
        f.set(i.dueAt);
        const n = await f.reviews.next(f.courseId, f.generator);
        const result = await f.reviews.answer(f.courseId, n.item!.id, { response: 'alpha' }, evaluator);
        assert.throws(() => f.db.prepare("UPDATE review_progress SET status='active',completed_at=NULL WHERE item_id=?").run(i.id), /transition/);
        assert.throws(() => f.db.prepare('UPDATE review_outcomes SET evidence_id=NULL WHERE item_id=?').run(i.id), /immutable/);
        assert.throws(() => f.db.prepare("INSERT INTO review_events(course_id,item_id,kind,at,reason,evaluation_id,evidence_id) VALUES (?,?, 'outcome_linked',?,'invalid',?,?)").run(f.courseId, i.id, f.clock().toISOString(), original.heads[0]!.id, original.heads[0]!.evidenceId), /scope/);
        assert(result.item.attemptId);
        assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    }
    finally {
        f.store.close();
    }
});
test('new evidence during generation rejects the stale proposal without a review task', async () => {
    const f = reviewFixture();
    try {
        f.support();
        f.set(f.reviews.queue(f.courseId).upcoming[0]!.dueAt);
        await assert.rejects(f.reviews.next(f.courseId, { propose: async context => {
            f.add({ conceptId: f.child });
            return { prompt: 'A fresh synthetic closed task.', scoring: { kind: 'numeric', expected: 1, tolerance: 0 }, sourceRefs: context.grounding.source.map(s => s.ref), researchRefs: context.grounding.research.map(r => r.ref) };
        } }), /State changed/);
        assert.equal(f.db.prepare('SELECT count(*) n FROM review_task_origins').get()!.n, 0);
        assert.equal(f.store.reviews.list(f.courseId).filter(i => i.status === 'active').length, 0);
    }
    finally { f.store.close(); }
});
