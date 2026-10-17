import assert from 'node:assert/strict';
test('reusing an AI-worked transfer-labelled task cannot manufacture positive transfer evidence',()=>{
 const f=learnerFixture();try{const shown=f.add({dimensions:['transfer'],novelty:'far_transfer',assistance:'ai_performed'});f.add({taskId:shown.task.id});const r=f.read();const d=r.dimensions.find(d=>d.conceptId===f.root&&d.dimension==='transfer')!;assert.equal(d.band,'untested');assert.equal(d.independentSuccessCount,0);assert.equal(r.observations[1]!.novelty,'far_transfer');assert.equal(r.observations[1]!.repeatedCase,true);}finally{f.store.close();}
});
import { test } from 'node:test';
import { learnerFixture, startTime } from './helpers/learner-state-fixtures.ts';
import { competenceProfile } from '../src/domain/competence-profile.ts';
import { dimensionBands, learnerId, verificationDelayMs } from '../src/domain/learner-state.ts';
import { ids, human } from './helpers/assessment-fixtures.ts';
const memory = (r: ReturnType<ReturnType<typeof learnerFixture>['read']>, id: string) => r.dimensions.find(d => d.conceptId === id && d.dimension === 'memory_accessibility')!;
test('learner/gap UUID contracts and actual M3 competence profiles are explicit', () => {
    assert(learnerId(ids('state'), 'state'));
    assert(learnerId(ids('gap'), 'gap'));
    for (const x of ['gap-1', ids('state').toUpperCase(), null])
        assert(!learnerId(x, 'gap'));
    assert.equal(dimensionBands.length, 7);
    assert.equal(verificationDelayMs, 86400000);
    assert.deepEqual(competenceProfile('definition'), ['memory_accessibility', 'structural_understanding', 'discrimination']);
    assert.deepEqual(competenceProfile('procedure'), ['structural_understanding', 'application', 'transfer', 'procedural_fluency', 'scaffold_independence']);
    assert.deepEqual(competenceProfile('concept'), ['memory_accessibility', 'structural_understanding', 'discrimination', 'application', 'transfer']);
    assert.deepEqual(competenceProfile('representation'), ['structural_understanding', 'discrimination', 'representation_flexibility']);
    assert.deepEqual(competenceProfile('boundary_case'), ['discrimination', 'application', 'transfer']);
    assert.equal(competenceProfile('misconception'), null);
    assert.equal(competenceProfile('assessment_objective'), null);
});
test('untested, assisted difficulty/success, independent difficulty and mixed bands retain distinct counts', () => {
    const f = learnerFixture();
    try {
        assert.equal(memory(f.read(), f.root).band, 'untested');
        f.add({ assistance: 'guided', correctness: 0 });
        let r = f.read();
        assert.equal(memory(r, f.root).band, 'assisted_difficulty');
        assert.equal(r.gaps.length, 1);
        const same = f.add({ assistance: 'minimal' });
        r = f.read();
        assert.equal(memory(r, f.root).band, 'assisted_only');
        assert.equal(memory(r, f.root).assistedFailureCount, 1);
        f.add({ correctness: 0 });
        r = f.read();
        assert.equal(memory(r, f.root).band, 'independent_difficulty');
        f.add({ taskId: same.task.id });
        r = f.read();
        assert.equal(memory(r, f.root).band, 'mixed');
        f.add();
        r = f.read();
        assert.equal(memory(r, f.root).band, 'provisional_support');
        assert.equal(r.gaps[0]!.status, 'AWAITING_VERIFICATION');
    }
    finally {
        f.store.close();
    }
});
for (const ms of [10 * 60 * 1000, verificationDelayMs - 1000, verificationDelayMs, verificationDelayMs + 1000])
    test('distinct delayed success boundary ' + ms, () => {
        const f = learnerFixture();
        try {
            const first = f.add({ at: startTime });
            f.add({ at: new Date(Date.parse(first.attempt.submittedAt) + ms).toISOString() });
            const r = f.read();
            assert.equal(memory(r, f.root).band, ms >= verificationDelayMs ? 'durable_support' : 'provisional_support');
        }
        finally {
            f.store.close();
        }
    });
test('time alone, same task and duplicate prompt under a new ID cannot provide delayed verification', () => {
    const f = learnerFixture();
    try {
        const first = f.add();
        const original = f.read();
        f.tick(verificationDelayMs * 2);
        assert.equal(f.read().id, original.id);
        f.add({ taskId: first.task.id });
        assert.equal(memory(f.read(), f.root).band, 'provisional_support');
        f.add({ prompt: first.task.prompt });
        assert.equal(memory(f.read(), f.root).band, 'provisional_support');
    }
    finally {
        f.store.close();
    }
});
for (const assistance of ['minimal', 'guided', 'worked_solution', 'ai_performed'] as const)
    test(assistance + ' never supplies independent competence or gap verification', () => {
        const f = learnerFixture();
        try {
            f.add({ correctness: 0 });
            f.add({ assistance, at: new Date(Date.parse(startTime) + verificationDelayMs * 2).toISOString() });
            const r = f.read();
            assert.equal(memory(r, f.root).independentSuccessCount, 0);
            assert.equal(r.gaps[0]!.status, assistance === 'ai_performed' ? 'OPEN' : 'REPAIR_IN_PROGRESS');
            assert.equal(r.readiness.find(c => c.conceptId === f.root)!.stage, 'instructionally_ready');
            if (assistance === 'ai_performed')
                assert.equal(memory(r, f.root).aiPerformedCount, 1);
        }
        finally {
            f.store.close();
        }
    });
test('partial, unscored, failed, ambiguous and multi-concept observations do not invent support or gaps', () => {
    const f = learnerFixture();
    try {
        f.add({ correctness: .5 });
        f.add({ status: 'unscored' });
        f.add({ status: 'failed' });
        f.add({ conceptIds: [f.root, f.child], correctness: 0 });
        const target = f.add();
        f.evaluations.record(f.courseId, target.attempt.id, 'branch', human, { status: 'scored', correctness: 0, rubricScores: {}, rationale: 'Synthetic conflicting head' });
        const r = f.read();
        const d = memory(r, f.root);
        assert.equal(d.band, 'untested');
        assert.equal(d.partialCount, 1);
        assert.equal(d.unscoredCount, 1);
        assert.equal(d.failedCount, 1);
        assert.equal(d.ambiguousCount, 2);
        assert.equal(r.gaps.length, 0);
        assert.equal(d.contextual.length, 6);
    }
    finally {
        f.store.close();
    }
});
test('transfer needs changed-context novelty; confidence alone and unscored teach-back cannot promote', () => {
    const f = learnerFixture();
    try {
        f.add({ dimensions: ['transfer'], novelty: 'isomorphic' });
        f.add({ dimensions: ['structural_understanding'], status: 'unscored', confidence: 1 });
        let r = f.read();
        assert.equal(r.dimensions.find(d => d.conceptId === f.root && d.dimension === 'transfer')!.band, 'untested');
        assert.equal(r.dimensions.find(d => d.conceptId === f.root && d.dimension === 'structural_understanding')!.band, 'untested');
        f.add({ dimensions: ['transfer'], novelty: 'near_transfer', confidence: 0 });
        r = f.read();
        assert.equal(r.dimensions.find(d => d.conceptId === f.root && d.dimension === 'transfer')!.band, 'provisional_support');
        assert.equal(r.dimensions.find(d => d.conceptId === f.root && d.dimension === 'calibration')!.confidenceObservations.length, 1);
        assert.equal(r.readiness.find(c => c.conceptId === f.root)!.stage, 'instructionally_ready');
        assert.equal(r.dimensions.find(d => d.conceptId === f.root && d.dimension === 'scaffold_independence')!.independentSuccessCount, 2);
    }
    finally {
        f.store.close();
    }
});
test('representation and highest novelty remain actual observed metadata without invented formats', () => {
    const f = learnerFixture();
    try {
        f.add({ representation: 'text', novelty: 'isomorphic' });
        f.add({ representation: 'symbolic', novelty: 'far_transfer' });
        const d = memory(f.read(), f.root);
        assert.deepEqual(d.representations, ['symbolic', 'text']);
        assert.equal(d.highestNovelty, 'far_transfer');
        assert(!d.representations.includes('graph'));
    }
    finally {
        f.store.close();
    }
});
