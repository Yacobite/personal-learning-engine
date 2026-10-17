import assert from 'node:assert/strict';
import { test } from 'node:test';
import { learnerFixture } from './helpers/learner-state-fixtures.ts';
import { verificationDelayMs } from '../src/domain/learner-state.ts';
import { human } from './helpers/assessment-fixtures.ts';
test('same task and copied prompt can repair but never close or start verification', () => {
    const f = learnerFixture();
    try {
        const trigger = f.add({ correctness: 0 });
        const first = f.read().gaps[0]!;
        f.add({ taskId: trigger.task.id });
        let gap = f.read().gaps[0]!;
        assert.equal(gap.id, first.id);
        assert.equal(gap.status, 'REPAIR_IN_PROGRESS');
        f.tick(verificationDelayMs * 2);
        f.add({ prompt: trigger.task.prompt });
        gap = f.read().gaps[0]!;
        assert.equal(gap.status, 'REPAIR_IN_PROGRESS');
        assert.equal(gap.awaitingAttemptId, null);
        assert.equal(gap.transitions.length, 3);
    }
    finally {
        f.store.close();
    }
});
for (const delay of [verificationDelayMs - 1000, verificationDelayMs, verificationDelayMs + 1000])
    test('gap delayed boundary ' + delay, () => {
        const f = learnerFixture();
        try {
            f.add({ correctness: 0 });
            const parallel = f.add();
            let gap = f.read().gaps[0]!;
            assert.equal(gap.status, 'AWAITING_VERIFICATION');
            assert.equal(gap.eligibleAfter, new Date(Date.parse(parallel.attempt.submittedAt) + verificationDelayMs).toISOString());
            f.add({ at: new Date(Date.parse(parallel.attempt.submittedAt) + delay).toISOString() });
            gap = f.read().gaps[0]!;
            assert.equal(gap.status, delay >= verificationDelayMs ? 'VERIFIED_CLOSED' : 'AWAITING_VERIFICATION');
        }
        finally {
            f.store.close();
        }
    });
test('failures deduplicate, reset verification and recurrence creates a new linked immutable gap', () => {
    const f = learnerFixture();
    try {
        f.add({ correctness: 0 });
        let gap = f.read().gaps[0]!;
        const id = gap.id;
        f.add({ correctness: 0, assistance: 'guided' });
        assert.equal(f.read().gaps.length, 1);
        f.add({ assistance: 'minimal' });
        assert.equal(f.read().gaps[0]!.status, 'REPAIR_IN_PROGRESS');
        f.add();
        assert.equal(f.read().gaps[0]!.status, 'AWAITING_VERIFICATION');
        f.add({ correctness: 0 });
        gap = f.read().gaps[0]!;
        assert.equal(gap.status, 'OPEN');
        assert.equal(gap.eligibleAfter, null);
        assert.equal(gap.transitions.at(-1)!.reason, 'failure_reset');
        const awaiting = f.add();
        f.read();
        f.add({ at: new Date(Date.parse(awaiting.attempt.submittedAt) + verificationDelayMs).toISOString() });
        const closed = f.read();
        assert.equal(closed.gaps[0]!.status, 'VERIFIED_CLOSED');
        f.add({ correctness: 0 });
        const recurrent = f.read();
        assert.equal(recurrent.gaps.length, 2);
        assert.equal(recurrent.gaps[0]!.id, id);
        assert.equal(recurrent.gaps[0]!.status, 'VERIFIED_CLOSED');
        assert.equal(recurrent.gaps[1]!.recursFrom, id);
        assert.notEqual(recurrent.gaps[1]!.id, id);
        assert.equal(f.gaps.show(f.courseId, id).history.at(-1)!.snapshot.status, 'VERIFIED_CLOSED');
    }
    finally {
        f.store.close();
    }
});
test('corrected trigger vanishes from current gaps while old revisions and original M4 evidence remain', () => {
    const f = learnerFixture();
    try {
        const trigger = f.add({ correctness: 0 });
        const before = f.read();
        const gap = before.gaps[0]!;
        f.tick(1000);
        f.evaluations.record(f.courseId, trigger.attempt.id, 'correct-trigger', human, { status: 'scored', correctness: 1, rubricScores: {}, rationale: 'Synthetic correction' }, trigger.evaluation.id);
        const after = f.read();
        assert.equal(after.gaps.length, 0);
        assert.notEqual(after.id, before.id);
        assert.equal(f.state.revision(f.courseId, before.id).gaps[0]!.id, gap.id);
        assert.equal(f.evaluations.list(f.courseId, trigger.attempt.id).length, 2);
        assert.equal(f.gaps.show(f.courseId, gap.id).current, null);
        assert.equal(f.evidence.show(f.courseId, trigger.evidence!.id).evaluation.correctness, 0);
    }
    finally {
        f.store.close();
    }
});
test('correction to the closing event invalidates closure and replays recurrence coherently', () => {
    const f = learnerFixture();
    try {
        f.add({ correctness: 0 });
        const firstRepair = f.add();
        f.read();
        const verification = f.add({ at: new Date(Date.parse(firstRepair.attempt.submittedAt) + verificationDelayMs).toISOString() });
        const closed = f.read();
        assert.equal(closed.gaps[0]!.status, 'VERIFIED_CLOSED');
        f.add({ correctness: 0 });
        const recurrence = f.read();
        assert.equal(recurrence.gaps.length, 2);
        f.tick(1000);
        f.evaluations.record(f.courseId, verification.attempt.id, 'invalidate-close', human, { status: 'scored', correctness: 0, rubricScores: {}, rationale: 'Synthetic delayed correction' }, verification.evaluation.id);
        const now = f.read();
        assert.equal(now.gaps.length, 1);
        assert.equal(now.gaps[0]!.status, 'OPEN');
        assert.equal(f.state.revision(f.courseId, recurrence.id).gaps.length, 2);
        assert.equal(f.state.revision(f.courseId, closed.id).gaps[0]!.status, 'VERIFIED_CLOSED');
    }
    finally {
        f.store.close();
    }
});
test('AI, partial, failed and multi-concept failures cannot trigger or close escrow', () => {
    const f = learnerFixture();
    try {
        f.add({ correctness: 0, assistance: 'ai_performed' });
        f.add({ correctness: .2 });
        f.add({ status: 'failed' });
        f.add({ conceptIds: [f.root, f.child], correctness: 0 });
        assert.equal(f.read().gaps.length, 0);
        f.add({ correctness: 0 });
        f.add({ assistance: 'ai_performed' });
        assert.equal(f.read().gaps[0]!.status, 'OPEN');
    }
    finally {
        f.store.close();
    }
});
