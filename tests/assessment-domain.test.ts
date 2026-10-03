import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistanceLevels, dimensions, isAssessmentId, taskTypes, representations, noveltyTypes } from '../src/domain/assessment.ts';
import { validateTask, validateSubmission, validateEvaluation, validateIdentity, validateScoring } from '../src/domain/assessment-validation.ts';
import { taskInput, submission, human, correct } from './helpers/assessment-fixtures.ts';
const concept = 'concept-00000000-0000-4000-8000-000000000001';
const task = 'task-00000000-0000-4000-8000-000000000001';
test('all four assessment IDs require exact lowercase UUID v4/version/variant', () => {
    for (const prefix of ['task', 'attempt', 'evaluation', 'evidence'] as const) {
        const id = `${prefix}-00000000-0000-4000-8000-000000000001`;
        assert.ok(isAssessmentId(id, prefix));
        for (const bad of [id.toUpperCase(), id.replace('-4000', '-5000'), id.replace('-8000', '-7000'), id + 'x', id.replace('000000000001', '00000000000g')])
            assert.equal(isAssessmentId(bad, prefix), false);
    }
});
test('task taxonomy, all representations, novelty and dimensions validate without learner state', () => {
    for (const type of taskTypes)
        assert.equal(validateTask({ ...taskInput(concept), type }).type, type);
    for (const representation of representations)
        assert.equal(validateTask({ ...taskInput(concept), representation }).representation, representation);
    for (const novelty of noveltyTypes)
        assert.equal(validateTask({ ...taskInput(concept), novelty }).novelty, novelty);
    assert.deepEqual(validateTask({ ...taskInput(concept), intendedDimensions: dimensions }).intendedDimensions, dimensions);
    for (const patch of [{ type: 'quiz' }, { intendedDimensions: ['mastery'] }, { intendedDimensions: [] }, { conceptIds: [] }, { conceptIds: [concept, concept] }, { curriculumVersion: '1' }, { mastery: 1 }, { prompt: ' ' }, { prompt: 'x'.repeat(16001) }, { origin: 'self_report' }])
        assert.throws(() => validateTask({ ...taskInput(concept), ...patch }));
});
test('assistance remains explicit; hints, confidence and latency are bounded separate data', () => {
    for (const assistance of assistanceLevels)
        assert.equal(validateSubmission({ ...submission(task), assistance }).assistance, assistance);
    assert.equal(validateSubmission({ ...submission(task), confidence: 0, latencyMs: 86400000 }).confidence, 0);
    assert.equal(validateSubmission({ ...submission(task), confidence: 1, latencyMs: 0 }).confidence, 1);
    for (const patch of [{ confidence: NaN }, { confidence: Infinity }, { confidence: 1.01 }, { confidence: -0.01 }, { latencyMs: -1 }, { latencyMs: Infinity }, { latencyMs: 86400001 }, { assistance: 'unknown' }, { hints: { count: 1, highestLevel: 'worked_solution', notes: null } }, { response: undefined }, { confidence: 0.9, taskId: undefined }])
        assert.throws(() => validateSubmission({ ...submission(task), ...patch }));
});
test('evaluation proposals reject retargeting, malformed statuses, unknown/prototype rubric keys', () => {
    const spec = taskInput(concept).scoring;
    for (const patch of [{ courseId: 'evil' }, { conceptIds: [concept] }, { curriculumVersion: 2 }, { assistance: 'none' }, { novelty: 'far_transfer' }, { mastery: 1 }, { readiness: true }, { correctness: NaN }, { correctness: Infinity }, { correctness: 0.5 }, { status: 'unscored' }, { status: 'failed' }, { rubricScores: { mastery: 1 } }, { rubricScores: JSON.parse('{"__proto__":1}') }])
        assert.throws(() => validateEvaluation({ ...correct, ...patch }, spec));
    assert.throws(() => validateIdentity({ ...human, apiKey: 'secret' }));
    assert.throws(() => validateIdentity({ ...human, model: 'fake' }));
});
test('bounded task-specific rubrics permit partial correctness only with complete rubric scores', () => {
    const scoring = validateScoring({ kind: 'open', expected: null, rubricVersion: 'synthetic-v1', criteria: [{ key: 'relation', description: 'Identify a relation.' }, { key: 'boundary', description: 'State the boundary.' }] });
    assert.equal(validateEvaluation({ ...correct, correctness: 0.5, rubricScores: { relation: 1, boundary: 0 } }, scoring).correctness, 0.5);
    for (const rubricScores of [{ relation: 1 }, { relation: 1, boundary: 2 }, { relation: 1, boundary: NaN }, { unknown: 1 }])
        assert.throws(() => validateEvaluation({ ...correct, correctness: 0.5, rubricScores }, scoring));
    for (const key of ['__proto__', 'constructor', 'prototype', 'x'.repeat(61)])
        assert.throws(() => validateScoring({ kind: 'open', expected: null, rubricVersion: 'v1', criteria: [{ key, description: 'Synthetic' }] }));
    assert.throws(() => validateScoring({ kind: 'open', expected: null, rubricVersion: 'v1', criteria: Array.from({ length: 21 }, (_, i) => ({ key: `k${i}`, description: 'Synthetic' })) }));
    assert.throws(() => validateScoring({ kind: 'numeric', expected: NaN, tolerance: 0 }));
    assert.throws(() => validateScoring({ kind: 'numeric', expected: 1, tolerance: Infinity }));
    assert.throws(() => validateScoring({ kind: 'numeric', expected: 1, tolerance: -1 }));
});
