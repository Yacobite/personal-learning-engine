import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewFixture, day, proposal } from './helpers/review-fixtures.ts';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import { temporalStatus } from '../src/domain/review.ts';
import { human } from './helpers/assessment-fixtures.ts';
const evaluator = new DeterministicEvaluator();
test('provisional schedules canonical M7 eligibility; hard gate, real M4 review and M7 durability', async () => {
    const f = reviewFixture();
    try {
        const state = f.support();
        const report = state.readiness.find(r => r.conceptId === f.root)!;
        assert.equal(report.stage, 'provisional_competence');
        const i = f.store.reviews.list(f.courseId)[0]!;
        assert.equal(i.kind, 'delayed_verification');
        assert.equal(i.earliestAt, report.delayed.eligibleAfter);
        assert.equal((await f.reviews.next(f.courseId, f.generator)).item, null);
        f.set(i.earliestAt);
        assert.equal(temporalStatus(i, f.clock().toISOString()), 'due');
        const n = await f.reviews.next(f.courseId, f.generator);
        assert(n.item?.taskId);
        assert.equal(f.assessments.task(f.courseId, n.item.taskId).origin, 'review_generated');
        const result = await f.reviews.answer(f.courseId, n.item.id, { response: 'alpha' }, evaluator);
        assert.equal(result.outcome, 'qualifying_success');
        assert.equal(result.item.status, 'completed');
        assert.equal(f.read().readiness.find(r => r.conceptId === f.root)!.stage, 'durable_mastery');
        const next = f.reviews.queue(f.courseId).upcoming[0]!;
        assert.equal(next.kind, 'maintenance');
        assert.equal(next.stage, 0);
        assert.equal(Date.parse(next.dueAt) - f.clock().getTime(), 3 * day);
        assert(f.store.assessments.evidenceForAttempt(f.courseId, result.item.attemptId!).length === 1);
    }
    finally {
        f.store.close();
    }
});
test('maintenance advances exactly 3/7/14/30/60/60 days through actual M4 outcomes', async () => {
    const f = reviewFixture();
    try {
        f.durable();
        for (const [step, days] of [3, 7, 14, 30, 60, 60].entries()) {
            const i = f.reviews.queue(f.courseId).upcoming.find(i => i.kind === 'maintenance')!;
            assert(i);
            assert.equal(i.stage, Math.min(step, 4));
            assert.equal(Date.parse(i.dueAt) - f.clock().getTime(), days * day);
            f.set(i.dueAt);
            const n = await f.reviews.next(f.courseId, f.generator);
            assert(n.item);
            await f.reviews.answer(f.courseId, n.item.id, { response: 'alpha' }, evaluator);
        }
        assert.equal(f.store.reviews.list(f.courseId).filter(i => i.status === 'completed').length, 6);
    }
    finally {
        f.store.close();
    }
});
test('OPEN/REPAIR gaps are not verification; parallel awaiting case schedules exact dimension/gate', async () => {
    const f = reviewFixture();
    try {
        f.add({ correctness: 0 });
        f.reviews.refresh(f.courseId);
        assert.equal(f.store.reviews.list(f.courseId).length, 0);
        const trigger = f.read().gaps[0]!;
        const repair = f.add({ assistance: 'guided' });
        f.reviews.refresh(f.courseId);
        assert.equal(f.read().gaps[0]!.status, 'REPAIR_IN_PROGRESS');
        assert.equal(f.store.reviews.list(f.courseId).length, 0);
        f.add();
        const state = f.reviews.refresh(f.courseId), gap = state.gaps[0]!;
        assert.equal(gap.status, 'AWAITING_VERIFICATION');
        const i = f.store.reviews.list(f.courseId)[0]!;
        assert.equal(i.gapId, trigger.id);
        assert.equal(i.dimension, gap.dimension);
        assert.equal(i.earliestAt, gap.eligibleAfter);
        assert.equal((await f.reviews.next(f.courseId, f.generator)).item, null);
        f.set(i.dueAt);
        const n = await f.reviews.next(f.courseId, f.generator);
        assert(n.item);
        await f.reviews.answer(f.courseId, n.item.id, { response: 'alpha' }, evaluator);
        assert.equal(f.read().gaps[0]!.status, 'VERIFIED_CLOSED');
        assert(repair.attempt.id);
    }
    finally {
        f.store.close();
    }
});
for (const assistance of ['minimal', 'guided', 'worked_solution', 'ai_performed'] as const)
    test(assistance + ' review does not advance; independent replacement after 24h', async () => {
        const f = reviewFixture();
        try {
            f.durable();
            const first = f.reviews.queue(f.courseId).upcoming[0]!;
            f.set(first.dueAt);
            const n = await f.reviews.next(f.courseId, f.generator);
            assert(n.item);
            await f.reviews.answer(f.courseId, n.item.id, { response: 'alpha', assistance }, evaluator);
            const next = f.reviews.queue(f.courseId).upcoming[0]!;
            assert.equal(next.stage, 0);
            assert.equal(Date.parse(next.dueAt) - f.clock().getTime(), day);
            assert.equal(f.read().readiness.find(r => r.conceptId === f.root)!.stage, 'durable_mastery');
        }
        finally {
            f.store.close();
        }
    });
test('incorrect maintenance records difficulty through M4/M7 and supersedes stale maintenance', async () => {
    const f = reviewFixture();
    try {
        f.durable();
        const i = f.reviews.queue(f.courseId).upcoming[0]!;
        f.set(i.dueAt);
        const n = await f.reviews.next(f.courseId, f.generator);
        assert(n.item);
        const r = await f.reviews.answer(f.courseId, n.item.id, { response: 'beta' }, evaluator);
        assert.equal(r.outcome, 'failure');
        const state = f.read();
        assert.notEqual(state.readiness.find(r => r.conceptId === f.root)!.stage, 'durable_mastery');
        assert(state.gaps.some(g => g.status === 'OPEN'));
        assert.equal(f.reviews.queue(f.courseId).upcoming.length, 0);
        f.support();
        f.tick(day);
        f.add({ dimensions: [i.dimension] });
        f.reviews.refresh(f.courseId);
        const next = f.reviews.queue(f.courseId).upcoming.find(i => i.kind === 'maintenance')!;
        assert.equal(next.stage, 0);
    }
    finally {
        f.store.close();
    }
});
test('one year overdue is competence-neutral and repeated refresh creates no duplicate', () => {
    const f = reviewFixture();
    try {
        const before = f.durable();
        const items = f.store.reviews.list(f.courseId);
        f.tick(day * 365);
        const q = f.reviews.queue(f.courseId);
        f.reviews.queue(f.courseId);
        assert.equal(q.due[0]!.temporalStatus, 'overdue');
        assert.equal(f.read().id, before.id);
        assert.equal(f.store.reviews.list(f.courseId).length, items.length);
    }
    finally {
        f.store.close();
    }
});
test('transient generator failure retries same target; duplicate prior performance prompt rejected', async () => {
    const f = reviewFixture();
    try {
        f.support();
        const i = f.reviews.queue(f.courseId).upcoming[0]!;
        f.set(i.dueAt);
        await assert.rejects(f.reviews.next(f.courseId, { propose: async () => { throw Error('provider'); } }), /provider/);
        assert.equal(f.store.reviews.list(f.courseId)[0]!.status, 'scheduled');
        const original = f.store.assessments.task(f.courseId, f.read().observations[0]!.taskId)!;
        await assert.rejects(f.reviews.next(f.courseId, { propose: async (c) => ({ ...proposal(c), prompt: '  ' + original.prompt.replaceAll(' ', '  ') + '  ' }) }), /Duplicate/);
        const n = await f.reviews.next(f.courseId, f.generator);
        assert.equal(n.item!.id, i.id);
        const replay = await f.reviews.next(f.courseId, { propose: async () => { throw Error('must not generate'); } });
        assert.equal(replay.item!.taskId, n.item!.taskId);
    }
    finally {
        f.store.close();
    }
});
test('evaluator failure keeps same attempt; explicit retry and replay preserve one performance', async () => {
    const f = reviewFixture();
    try {
        f.support();
        f.set(f.reviews.queue(f.courseId).upcoming[0]!.dueAt);
        const n = await f.reviews.next(f.courseId, f.generator);
        assert(n.item);
        const r = await f.reviews.answer(f.courseId, n.item.id, { response: 'alpha' }, { identity: evaluator.identity, evaluate: async () => { throw Error('failed'); } });
        assert.equal(r.item.status, 'awaiting_evaluation');
        assert.equal(r.outcome, 'evaluation_failed');
        const attempt = r.item.attemptId;
        const retry = await f.reviews.retryEvaluation(f.courseId, n.item.id, evaluator);
        assert.equal(retry.item.attemptId, attempt);
        assert.equal(retry.item.status, 'completed');
        const replay = await f.reviews.answer(f.courseId, n.item.id, { response: 'alpha' }, evaluator);
        assert.equal(replay.item.attemptId, attempt);
        await assert.rejects(f.reviews.answer(f.courseId, n.item.id, { response: 'beta' }, evaluator), /conflicts/);
    }
    finally {
        f.store.close();
    }
});
test('corrected terminal outcome reconciles future items without rewriting completed review', async () => {
    const f = reviewFixture();
    try {
        f.durable();
        const i = f.reviews.queue(f.courseId).upcoming[0]!;
        f.set(i.dueAt);
        const n = await f.reviews.next(f.courseId, f.generator);
        const r = await f.reviews.answer(f.courseId, n.item!.id, { response: 'alpha' }, evaluator);
        const future = f.reviews.queue(f.courseId).upcoming[0]!;
        const head = f.evaluations.heads(f.courseId, r.item.attemptId!)[0]!;
        f.evaluations.record(f.courseId, r.item.attemptId!, 'correct-review', human, { status: 'scored', correctness: 0, rubricScores: {}, rationale: 'Synthetic correction' }, head.id);
        f.reviews.refresh(f.courseId);
        assert.equal(f.reviews.get(f.courseId, future.id).status, 'superseded');
        assert.deepEqual(f.reviews.get(f.courseId, r.item.id), r.item);
        assert.equal(f.reviews.show(f.courseId, r.item.id).outcome, 'failure');
    }
    finally {
        f.store.close();
    }
});
test('late scheduler installation uses the first qualifying durable event, not the latest success or snapshot time', () => {
    const f = reviewFixture();
    try {
        // Seed via M4, without any M7/M8 refresh at the first durable point.
        for (const dimension of ['memory_accessibility', 'structural_understanding', 'discrimination', 'application', 'transfer'] as const)
            f.add({ dimensions: [dimension], novelty: dimension === 'transfer' ? 'near_transfer' : 'isomorphic' });
        f.tick(day);
        const qualifying = f.add();
        f.tick(10 * day);
        f.add({ dimensions: ['application'] });
        const before = f.state.history(f.courseId).length;
        const state = f.reviews.refresh(f.courseId), item = f.store.reviews.list(f.courseId)[0]!;
        assert.equal(Date.parse(item.dueAt) - Date.parse(qualifying.attempt.submittedAt), 3 * day);
        const revisions = f.state.history(f.courseId).length;
        assert.equal(revisions, before + 1);
        const timeline = f.state.competenceTimeline(f.courseId, f.root, state.id);
        assert.equal(timeline.at(-1)!.attemptId, qualifying.attempt.id);
        assert.equal(f.state.history(f.courseId).length, revisions, 'timeline publishes no learner-state revisions');
    }
    finally {
        f.store.close();
    }
});
for (const kind of ['delayed_verification', 'gap_verification'] as const)
    test('AI work cannot satisfy ' + kind, async () => {
        const f = reviewFixture();
        try {
            if (kind === 'delayed_verification')
                f.support();
            else {
                f.add({ correctness: 0 });
                f.add();
                f.reviews.refresh(f.courseId);
            }
            const i = f.store.reviews.list(f.courseId).find(i => i.kind === kind && i.status === 'scheduled')!;
            f.set(i.dueAt);
            const n = await f.reviews.next(f.courseId, f.generator);
            assert.equal(n.item!.id, i.id);
            const r = await f.reviews.answer(f.courseId, i.id, { response: 'alpha', assistance: 'ai_performed' }, evaluator);
            assert.equal(r.outcome, 'ai_performed');
            const state = f.read();
            assert.notEqual(state.readiness.find(r => r.conceptId === f.root)!.stage, 'durable_mastery');
            if (kind === 'gap_verification')
                assert.equal(state.gaps[0]!.status, 'AWAITING_VERIFICATION');
            const replacement = f.reviews.queue(f.courseId).upcoming.find(i => i.kind === kind)!;
            assert.equal(Date.parse(replacement.dueAt) - f.clock().getTime(), day);
        }
        finally {
            f.store.close();
        }
    });
test('duplicate protection also covers a previously shown review with no learner attempt', async () => {
    const f = reviewFixture();
    try {
        f.support();
        f.set(f.reviews.queue(f.courseId).upcoming[0]!.dueAt);
        const first = (await f.reviews.next(f.courseId, f.generator)).item!;
        const oldPrompt = f.assessments.task(f.courseId, first.taskId!).prompt;
        f.store.reviews.transition(f.courseId, first.id, 'superseded', f.clock().toISOString(), 'Synthetic replacement test');
        await assert.rejects(f.reviews.next(f.courseId, { propose: async c => ({ ...proposal(c), prompt: oldPrompt }) }), /Duplicate/);
        assert.equal(f.store.assessments.attemptOperation(f.courseId, 'review:' + first.id), undefined);
    }
    finally { f.store.close(); }
});
