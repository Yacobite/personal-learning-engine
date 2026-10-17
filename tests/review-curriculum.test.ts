import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewFixture } from './helpers/review-fixtures.ts';
import { proposal } from './helpers/graph-fixtures.ts';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
function version(f: ReturnType<typeof reviewFixture>, reuse: boolean) {
    const original = proposal();
    const p = { ...original, nodes: original.nodes.map((n, index) => ({ ...n, ...(reuse ? { conceptId: f.graph.nodes[index]!.conceptId } : {}), title: f.graph.nodes[index]!.title })) };
    return f.graphs.createDraft(f.courseId, p);
}
test('v2 retains v1 history; reused stable concept retains compatible maintenance ladder; new IDs inherit nothing', async () => {
    const f = reviewFixture();
    try {
        f.durable();
        const initial = f.reviews.queue(f.courseId).upcoming[0]!;
        f.set(initial.dueAt);
        const n = await f.reviews.next(f.courseId, f.generator);
        await f.reviews.answer(f.courseId, n.item!.id, { response: 'alpha' }, new DeterministicEvaluator());
        const oldFuture = f.reviews.queue(f.courseId).upcoming[0]!;
        assert.equal(oldFuture.stage, 1);
        const v2 = version(f, true);
        f.graphs.activate(f.courseId, v2.version);
        const q = f.reviews.queue(f.courseId);
        assert.equal(q.curriculumVersion, 2);
        assert.equal(q.upcoming[0]!.stage, 1);
        assert.equal(q.upcoming[0]!.dueAt, oldFuture.dueAt);
        assert.equal(f.reviews.get(f.courseId, oldFuture.id).status, 'superseded');
        assert.equal(f.reviews.get(f.courseId, oldFuture.id).curriculumVersion, 1);
        assert.equal(f.reviews.get(f.courseId, n.item!.id).status, 'completed');
        const v3 = version(f, false);
        f.graphs.activate(f.courseId, v3.version);
        const next = f.reviews.queue(f.courseId);
        assert.equal(next.due.length + next.upcoming.length, 0);
    }
    finally {
        f.store.close();
    }
});
test('changed node profile reconciles from current M7 requirements instead of inheriting a stale schedule', () => {
    const f = reviewFixture();
    try {
        f.durable();
        const i = f.reviews.queue(f.courseId).upcoming[0]!;
        const original = proposal();
        const p = { ...original, nodes: original.nodes.map((n, index) => ({ ...n, conceptId: f.graph.nodes[index]!.conceptId, type: 'procedure' as const })) };
        const v = f.graphs.createDraft(f.courseId, p);
        f.graphs.activate(f.courseId, v.version);
        const q = f.reviews.queue(f.courseId);
        assert.equal(q.upcoming.length, 0);
        assert.equal(f.reviews.get(f.courseId, i.id).status, 'superseded');
    }
    finally {
        f.store.close();
    }
});
