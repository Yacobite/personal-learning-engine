import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpret, findings } from '../src/domain/diagnostic.ts';
import type { Finding, Observation, DiagnosticProbe } from '../src/domain/diagnostic.ts';
import { selection, frontier } from '../src/domain/diagnostic-policy.ts';
import type { CurriculumVersion } from '../src/domain/curriculum.ts';
import { fixture, submission, taskInput, human, correct } from './helpers/assessment-fixtures.ts';
const graph = (ids: string[], edges: string[][]): CurriculumVersion => ({ courseId: 'synthetic', version: 1, createdAt: 'synthetic', activatedAt: null, rationale: 'Synthetic', uncertainty: [], nodes: ids.map(conceptId => ({ conceptId, title: conceptId, type: 'concept', summary: 'Synthetic', sourceRefs: [], researchRefs: [] })), edges: edges.map(([from, to]) => ({ from: from!, to: to!, type: 'prerequisite_of', rationale: 'Synthetic' })) });
const values = (g: CurriculumVersion, s: Record<string, Finding['state']> = {}): Finding[] => g.nodes.map(n => ({ conceptId: n.conceptId, state: s[n.conceptId] ?? 'not_probed', observations: [] }));
const probes = (ids: string[]): DiagnosticProbe[] => ids.map((conceptId, i) => ({ id: `synthetic-${i}`, courseId: 'synthetic', sessionId: 'synthetic', curriculumVersion: 1, sequence: i + 1, conceptId, taskId: `synthetic-task-${i}`, attemptId: null, status: 'resolved', selectionReason: 'synthetic', createdAt: 'synthetic', answeredAt: null, resolvedAt: 'synthetic', outcomes: [] }));
for (const [name, ids, edges] of [['chain', ['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']]], ['diamond', ['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]], ['branches', ['a', 'b', 'c', 'd', 'e'], [['a', 'b'], ['b', 'd'], ['a', 'c'], ['c', 'e']]], ['multiple roots', ['a', 'b', 'c'], [['a', 'c'], ['b', 'c']]], ['disconnected', ['a', 'b', 'x', 'y'], [['a', 'b'], ['x', 'y']]]] as const) {
    test(`diagnostic navigation terminates deterministically on ${name}`, () => { const g = graph([...ids], edges.map(e => [...e])); const ps: DiagnosticProbe[] = []; const states: Record<string, Finding['state']> = {}; for (let i = 0; i <= ids.length; i++) {
        const v = values(g, states);
        const a = selection(g, v, ps, [], 20);
        assert.deepEqual(a, selection(g, v, ps, [], 20));
        if ('stop' in a) {
            assert.equal(a.stop, 'coverage_sufficient');
            assert.equal(ps.length, ids.length);
            return;
        }
        states[a.conceptId] = 'provisionally_supported';
        ps.push(...probes([a.conceptId]).map(p => ({ ...p, sequence: ps.length + 1 })));
    } assert.fail('Did not terminate'); });
}
test('direct support moves up; difficulty moves down; ancestors receive no invented observations', () => { const g = graph(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']]); const ps = probes(['b']); assert.deepEqual(selection(g, values(g, { b: 'provisionally_supported' }), ps, [], 6), { conceptId: 'c', reason: 'check_dependent_after_direct_support' }); assert.deepEqual(selection(g, values(g, { b: 'provisionally_unsupported' }), ps, [], 6), { conceptId: 'a', reason: 'check_prerequisite_after_difficulty_or_uncertainty' }); assert.equal(values(g, { b: 'provisionally_supported' })[0]!.state, 'not_probed'); });
test('frontier requires every branch bounded; graph closure does not classify descendants', () => { const g = graph(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]); const v = values(g, { a: 'provisionally_supported', b: 'provisionally_unsupported' }); assert.ok(!('stop' in selection(g, v, probes(['a', 'b']), [], 20))); const final = values(g, { a: 'provisionally_supported', b: 'provisionally_unsupported', c: 'provisionally_supported' }); assert.deepEqual(selection(g, final, probes(['a', 'b', 'c']), [], 20), { stop: 'frontier_located' }); assert.equal(final.find(f => f.conceptId === 'd')!.state, 'not_probed'); assert.deepEqual(frontier(g, final), [{ conceptId: 'b', reason: 'direct_difficulty' }]); });
test('budget and no eligible stops remain distinct', () => { const g = graph(['a'], []); assert.deepEqual(selection(g, values(g), probes(['a']), [], 1), { stop: 'budget_exhausted' }); assert.deepEqual(selection(g, values(g), probes(['a']), [], 6), { stop: 'no_eligible_probe' }); });
for (const [assistance, score, status, expected, reason] of [
    ['none', 1, 'scored', 'provisionally_supported', 'independent_correct'], ['none', 0, 'scored', 'provisionally_unsupported', 'independent_incorrect'], ['guided', 1, 'scored', 'uncertain', 'assisted_observation'], ['ai_performed', 1, 'scored', 'uncertain', 'ai_performed_excluded'], ['none', null, 'unscored', 'uncertain', 'unscored'], ['none', null, 'failed', 'uncertain', 'failed'], ['none', 0.5, 'scored', 'uncertain', 'partial_score']
] as const)
    test(`diagnostic interpretation ${assistance}/${status}/${score}`, () => { const f = fixture(); try {
        const task = f.assessments.createTask(f.courseId, taskInput(f.graph.nodes[0]!.conceptId));
        const a = f.assessments.submit(f.courseId, 'synthetic', { ...submission(task.id), assistance, confidence: 1 });
        const e = f.evaluations.record(f.courseId, a.id, 'synthetic-grade', human, status === 'scored' ? { ...correct, correctness: score === 0.5 ? 1 : score } : { status, correctness: null, rubricScores: {}, rationale: 'Synthetic' }).evaluation;
        const o = interpret(task, a, [{ ...e, correctness: score }], []);
        assert.equal(o.state, expected);
        assert.equal(o.reason, reason);
    }
    finally {
        f.store.close();
    } });
test('correction counts one attempt; multiple heads and multiple targets are uncertain', () => { const f = fixture(); try {
    const t = f.assessments.createTask(f.courseId, taskInput(f.graph.nodes[0]!.conceptId));
    const a = f.assessments.submit(f.courseId, 's', submission(t.id));
    const e1 = f.evaluations.record(f.courseId, a.id, 'e1', human, correct);
    const e2 = f.evaluations.record(f.courseId, a.id, 'e2', human, { ...correct, correctness: 0 }, e1.evaluation.id);
    assert.equal(interpret(t, a, f.evaluations.heads(f.courseId, a.id), []).state, 'provisionally_unsupported');
    assert.equal(interpret(t, a, [e1.evaluation, e2.evaluation], []).reason, 'conflicting_terminal_heads');
    assert.equal(interpret({ ...t, conceptIds: [...t.conceptIds, 'second'] }, a, [e1.evaluation], []).reason, 'ambiguous_multiple_targets');
}
finally {
    f.store.close();
} });
test('conflicting observations retain representation and become mixed', () => { const base: Observation = { attemptId: 'one', taskId: 't', conceptIds: ['a'], type: 'cued_recall', representation: 'text', novelty: 'isomorphic', assistance: 'none', submittedAt: 'synthetic', evaluations: [], evidenceIds: [], state: 'provisionally_supported', reason: 'synthetic' }; const result = findings(['a', 'b'], [base, { ...base, attemptId: 'two', representation: 'symbolic', state: 'provisionally_unsupported' }]); assert.equal(result[0]!.state, 'mixed'); assert.deepEqual(result[0]!.observations.map(o => o.representation), ['text', 'symbolic']); assert.equal(result[1]!.state, 'not_probed'); });
