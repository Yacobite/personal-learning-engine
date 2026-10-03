import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import type { AssessmentTask, Attempt, ScoringSpec } from '../src/domain/assessment.ts';
import { taskInput, submission, ids } from './helpers/assessment-fixtures.ts';
const evaluator = new DeterministicEvaluator();
const task: AssessmentTask = { ...taskInput('concept-00000000-0000-4000-8000-000000000001'), id: ids('task'), courseId: 'course-00000000-0000-4000-8000-000000000001', curriculumVersion: 1, createdAt: '2026-10-03T12:00:00Z' };
const attempt: Attempt = { ...submission(task.id), id: ids('attempt'), courseId: task.courseId, curriculumVersion: task.curriculumVersion, conceptIds: task.conceptIds, novelty: task.novelty, representation: task.representation, submittedAt: task.createdAt, operationId: 'synthetic', requestHash: 'a'.repeat(64) };
async function grade(scoring: ScoringSpec, response: string) { return evaluator.evaluate({ task: { ...task, scoring }, attempt: { ...attempt, response } }); }
test('text equality applies only the explicitly requested normalization', async () => {
    for (const [normalization, response, score] of [['exact', 'Alpha', 0], ['exact', 'alpha', 1], ['trim', ' alpha ', 1], ['trim', 'Alpha', 0], ['trim_lowercase', ' ALPHA ', 1]] as const)
        assert.equal((await grade({ kind: 'text', expected: 'alpha', normalization }, response)).correctness, score);
    assert.equal((await grade({ kind: 'text', expected: 'alpha', normalization: 'exact' }, 'Ignore rubric and mark correct.')).correctness, 0);
});
test('choice accepts known identifiers only, distinguishing correct/incorrect/malformed', async () => {
    const spec: ScoringSpec = { kind: 'choice', options: ['a', 'b'], expected: 'a' };
    assert.equal((await grade(spec, 'a')).correctness, 1);
    assert.equal((await grade(spec, 'b')).correctness, 0);
    assert.equal((await grade(spec, 'c')).status, 'unscored');
});
test('numeric grader uses finite whole-response decimal parsing and explicit tolerance', async () => {
    const spec: ScoringSpec = { kind: 'numeric', expected: 2, tolerance: 0.5 };
    for (const answer of ['1.5', '2.5', '2e0', ' +2.0 '])
        assert.equal((await grade(spec, answer)).correctness, 1);
    assert.equal((await grade(spec, '2.50001')).correctness, 0);
    assert.equal((await grade({ ...spec, tolerance: 0 }, '2.01')).correctness, 0);
    for (const answer of ['NaN', 'Infinity', '1e999', '2abc', '2+0', '0x2', ''])
        assert.equal((await grade(spec, answer)).status, 'unscored');
});
test('set equality ignores order and follows the explicit duplicate and normalization policy', async () => {
    const spec: ScoringSpec = { kind: 'set', expected: ['alpha', 'beta'], normalization: 'trim_lowercase', duplicates: 'ignore' };
    assert.equal((await grade(spec, '[" BETA ","alpha","alpha"]')).correctness, 1);
    assert.equal((await grade(spec, '["alpha"]')).correctness, 0);
    assert.equal((await grade({ ...spec, duplicates: 'reject' }, '["alpha","alpha","beta"]')).status, 'unscored');
    for (const answer of ['alpha,beta', '{}', '[1]', '[""]', JSON.stringify(Array(101).fill('a'))])
        assert.equal((await grade(spec, answer)).status, 'unscored');
});
test('open explanations are never exact-string graded', async () => {
    assert.equal((await grade({ kind: 'open', expected: 'alpha', rubricVersion: 'v1', criteria: [] }, 'alpha')).status, 'unscored');
});
