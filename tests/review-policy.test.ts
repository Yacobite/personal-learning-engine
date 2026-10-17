import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maintenanceDays, reviewCandidates } from '../src/domain/review-schedule-policy.ts';
import { reviewQueue } from '../src/domain/review-queue-policy.ts';
import { reviewId, reviewOutcome, temporalStatus, validateReview, reviewLimit } from '../src/domain/review.ts';
import type { ReviewItem } from '../src/domain/review.ts';
import { reviewFixture, day } from './helpers/review-fixtures.ts';
import { ids, hash } from './helpers/assessment-fixtures.ts';
test('review IDs, policies, stages, UTC timestamps and hard dimension/novelty constraints validate', () => {
    const f = reviewFixture();
    try {
        f.support();
        const i = f.store.reviews.list(f.courseId)[0]!;
        validateReview(i);
        assert(reviewId(i.id));
        for (const id of [i.id.toUpperCase(), 'review-' + i.conceptId, i.id.slice(0, 21) + '5' + i.id.slice(22)])
            assert(!reviewId(id));
        for (const fields of [{ earliestAt: 'tomorrow' }, { dueAt: '2000-01-01T00:00:00.000Z' }, { stage: -1 }, { stage: 5 }, { dimension: 'calibration' }, { dimension: 'transfer', novelty: 'isomorphic' }, { assistance: 'guided' }, { kind: 'gap_verification', gapId: null }, { basis: 'xyz' }, { policies: { spacing: 'FSRS' } }])
            assert.throws(() => validateReview({ ...i, ...fields } as ReviewItem));
        assert.deepEqual([0, 1, 2, 3, 4, 5, 99].map(maintenanceDays), [3, 7, 14, 30, 60, 60, 60]);
        for (const stage of [-1, 0.5, NaN])
            assert.throws(() => maintenanceDays(stage));
        for (const limit of [0, 51, 1.5, NaN])
            assert.throws(() => reviewLimit(limit));
        f.set(i.earliestAt);
        assert.equal(temporalStatus(i, f.clock().toISOString()), 'due');
        f.tick(1);
        assert.equal(temporalStatus(i, f.clock().toISOString()), 'overdue');
        f.tick(-2);
        assert.equal(temporalStatus(i, f.clock().toISOString()), 'upcoming');
    }
    finally {
        f.store.close();
    }
});
test('queue enforces six priority classes, overdue age and deterministic concept/dimension/type/representation interleaving', () => {
    const f = reviewFixture();
    try {
        f.support();
        const base = f.store.reviews.list(f.courseId)[0]!, now = base.dueAt;
        const items: ReviewItem[] = [];
        for (const kind of ['maintenance', 'delayed_verification', 'gap_verification'] as const)
            for (const offset of [0, -day])
                items.push({ ...base, id: ids('review'), kind, dueAt: new Date(Date.parse(now) + offset).toISOString(), earliestAt: new Date(Date.parse(now) + offset).toISOString() });
        const sorted = reviewQueue(items, now);
        assert.deepEqual(sorted.map(i => [i.kind, temporalStatus(i, now)]), [['gap_verification', 'overdue'], ['gap_verification', 'due'], ['delayed_verification', 'overdue'], ['delayed_verification', 'due'], ['maintenance', 'overdue'], ['maintenance', 'due']]);
        assert.deepEqual(reviewQueue([...items].reverse(), now), sorted);
        const other = { ...base, id: ids('review'), conceptId: f.child };
        const recent = { ...base, id: ids('review'), status: 'completed' as const, completedAt: now };
        assert.equal(reviewQueue([base, other, recent], now)[0]!.conceptId, f.child);
        const future = { ...base, id: ids('review'), earliestAt: new Date(Date.parse(now) + day).toISOString(), dueAt: new Date(Date.parse(now) + day).toISOString() };
        assert.equal(reviewQueue([future], now, 10, { deadlineAt: now }).length, 0);
    }
    finally {
        f.store.close();
    }
});
test('scheduler-facing outcome classification excludes partial, unscored, AI, hints, ambiguity and early/repeated cases', () => {
    const f = reviewFixture();
    try {
        const state = f.support();
        const item = f.store.reviews.list(f.courseId)[0]!;
        const o = structuredClone(state.observations[0]!);
        o.originalVersion = item.curriculumVersion;
        o.conceptIds = [item.conceptId];
        o.dimensions = [item.dimension];
        o.type = item.type;
        o.representation = item.representation;
        o.novelty = item.novelty;
        o.at = item.earliestAt;
        o.repeatedCase = false;
        assert.equal(reviewOutcome(item, o), 'qualifying_success');
        for (const [patch, outcome] of [[{ correctness: 0.5 }, 'partial'], [{ correctness: 0 }, 'failure'], [{ assistance: 'ai_performed' }, 'ai_performed'], [{ independent: false }, 'assisted_success'], [{ ambiguous: true }, 'ambiguous'], [{ repeatedCase: true }, 'ambiguous'], [{ at: new Date(Date.parse(item.earliestAt) - 1).toISOString() }, 'ambiguous']] as const)
            assert.equal(reviewOutcome(item, { ...o, ...patch }), outcome);
        assert.equal(reviewOutcome(item, { ...o, heads: [{ ...o.heads[0]!, status: 'unscored', correctness: null }] }), 'unscored');
        assert.equal(reviewOutcome(item, { ...o, heads: [] }), 'evaluation_failed');
    }
    finally {
        f.store.close();
    }
});
test('candidate generation leaves merely instructionally ready concepts unscheduled and retains semantic basis', () => {
    const f = reviewFixture();
    try {
        let s = f.reviews.refresh(f.courseId);
        assert.equal(reviewCandidates(s, [], {}, hash).length, 0);
        s = f.support();
        const before = f.store.reviews.list(f.courseId)[0]!;
        f.add({ conceptId: f.child, dimensions: ['memory_accessibility'] });
        s = f.reviews.refresh(f.courseId);
        assert.equal(f.store.reviews.list(f.courseId).find(i => i.id === before.id)!.status, 'scheduled');
        assert.equal(f.store.reviews.list(f.courseId).filter(i => i.conceptId === f.root).length, 1);
        assert.notEqual(s.id, before.stateRevisionId);
    }
    finally {
        f.store.close();
    }
});
