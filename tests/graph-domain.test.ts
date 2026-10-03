import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prerequisiteOrder } from '../src/domain/curriculum.ts';
import type { ProposalEdge } from '../src/domain/curriculum.ts';
import { validateProposal } from '../src/domain/proposal-validation.ts';
import { proposal } from './helpers/graph-fixtures.ts';
const edge = (from: string, to: string, type: ProposalEdge['type'] = 'prerequisite_of'): ProposalEdge => ({ from, to, type, rationale: 'Fixture relation' });
test('prerequisite chains and diamonds sort deterministically; isolated nodes are included', () => {
    assert.deepEqual(prerequisiteOrder(['d', 'c', 'b', 'a'], [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')]), ['a', 'b', 'c', 'd']);
    assert.deepEqual(prerequisiteOrder(['z', 'a', 'b'], [edge('a', 'b')]), ['a', 'b', 'z']);
});
for (const edges of [[edge('a', 'a')], [edge('a', 'b'), edge('b', 'a')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]])
    test(`rejects prerequisite cycle of length ${edges.length}`, () => {
        assert.throws(() => prerequisiteOrder(['a', 'b', 'c'], edges), /cycle|self-loop/);
    });
for (const type of ['confusable_with', 'related_to'] as const)
    test(`${type} cycles do not participate in prerequisite ordering`, () => {
        assert.deepEqual(prerequisiteOrder(['c', 'b', 'a'], [edge('a', 'b'), edge('b', 'c'), edge('c', 'b', type), edge('b', 'c', type)]), ['a', 'b', 'c']);
    });
test('proposal validation rejects malformed runtime data, duplicates, invented enums and learner-state fields', () => {
    const valid = proposal();
    assert.deepEqual(validateProposal(valid), valid);
    for (const input of [null, {}, { ...valid, mastery: 1 }, { ...valid, active: true }, { ...valid, nodes: [] },
        { ...valid, nodes: [...valid.nodes, valid.nodes[0]] }, { ...valid, edges: [...valid.edges, ...valid.edges] },
        { ...valid, nodes: [{ ...valid.nodes[0], type: 'mastered' }] },
        { ...valid, nodes: [{ ...valid.nodes[0], mastery: 'verified' }] },
        { ...valid, nodes: [{ ...valid.nodes[0], conceptId: '../invalid' }] },
        { ...valid, edges: [edge('a', 'invented')] }, { ...valid, nodes: Array(501).fill(valid.nodes[0]) },
        { ...valid, rationale: 'x'.repeat(4001) }, { ...valid, nodes: [{ ...valid.nodes[0], sourceRefs: [], researchRefs: [] }] }])
        assert.throws(() => validateProposal(input));
});
