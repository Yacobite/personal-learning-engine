import assert from 'node:assert/strict';
import { test } from 'node:test';
import { learnerFixture } from './helpers/learner-state-fixtures.ts';
import { competenceProfile } from '../src/domain/competence-profile.ts';
import { verificationDelayMs } from '../src/domain/learner-state.ts';
import { proposal } from './helpers/graph-fixtures.ts';
const required = [...competenceProfile('concept')!];
test('ambiguous multi-concept performance cannot remove established competence from every target', () => {
    const f = learnerFixture();
    try {
        const first = f.add({ dimensions: required, novelty: 'near_transfer' });
        f.add({ dimensions: required, novelty: 'near_transfer', at: new Date(Date.parse(first.attempt.submittedAt) + verificationDelayMs).toISOString() });
        assert.equal(f.read().readiness.find(c => c.conceptId === f.root)!.stage, 'durable_mastery');
        f.add({ conceptIds: [f.root, f.child], dimensions: required, correctness: 0, novelty: 'near_transfer' });
        const r = f.read();
        assert.equal(r.readiness.find(c => c.conceptId === f.root)!.stage, 'durable_mastery');
        assert.equal(r.gaps.length, 0);
    }
    finally {
        f.store.close();
    }
});
test('root ready for instruction; child missing prerequisite; direct competence never manufactures parents', () => {
    const f = learnerFixture();
    try {
        let r = f.read();
        assert.equal(r.readiness.find(c => c.conceptId === f.root)!.stage, 'instructionally_ready');
        assert.equal(r.readiness.find(c => c.conceptId === f.child)!.stage, 'not_ready');
        const first = f.add({ conceptId: f.child, dimensions: required, novelty: 'near_transfer' });
        r = f.read();
        let child = r.readiness.find(c => c.conceptId === f.child)!;
        assert.equal(child.stage, 'provisional_competence');
        assert.deepEqual(child.prerequisiteWarnings, [f.root]);
        assert(child.missingDurable.includes('delayed_independent_verification'));
        f.add({ conceptId: f.child, dimensions: required, novelty: 'near_transfer', at: new Date(Date.parse(first.attempt.submittedAt) + verificationDelayMs).toISOString() });
        r = f.read();
        child = r.readiness.find(c => c.conceptId === f.child)!;
        assert.equal(child.stage, 'durable_mastery');
        assert(r.dimensions.filter(d => d.conceptId === f.root).every(d => d.band === 'untested'));
        f.add({ conceptId: f.child, dimensions: ['application'], correctness: 0 });
        r = f.read();
        assert.notEqual(r.readiness.find(c => c.conceptId === f.child)!.stage, 'durable_mastery');
        assert(r.gaps.some(g => g.conceptId === f.child && g.status === 'OPEN'));
    }
    finally {
        f.store.close();
    }
});
test('provisional prerequisite unlocks instruction without child evidence or ancestor propagation', () => {
    const f = learnerFixture();
    try {
        f.add({ dimensions: required, novelty: 'near_transfer' });
        const r = f.read();
        assert.equal(r.readiness.find(c => c.conceptId === f.root)!.stage, 'provisional_competence');
        assert.equal(r.readiness.find(c => c.conceptId === f.child)!.stage, 'instructionally_ready');
        assert(r.dimensions.filter(d => d.conceptId === f.child).every(d => d.qualifyingCount === 0));
    }
    finally {
        f.store.close();
    }
});
test('awaiting verification allows provisional competence but blocks durable mastery', () => {
    const f = learnerFixture();
    try {
        f.add({ dimensions: required, novelty: 'near_transfer', correctness: 0 });
        f.add({ dimensions: required, novelty: 'near_transfer' });
        let r = f.read();
        assert.equal(r.readiness.find(c => c.conceptId === f.root)!.stage, 'provisional_competence');
        assert(r.gaps.every(g => g.status === 'AWAITING_VERIFICATION'));
        const awaiting = r.observations.at(-1)!;
        f.add({ dimensions: required, novelty: 'near_transfer', at: new Date(Date.parse(awaiting.at) + verificationDelayMs).toISOString() });
        r = f.read();
        assert.equal(r.readiness.find(c => c.conceptId === f.root)!.stage, 'durable_mastery');
        assert(r.gaps.every(g => g.status === 'VERIFIED_CLOSED'));
    }
    finally {
        f.store.close();
    }
});
test('stable identity shares historical evidence; new similar title does not; type changes alter profile', () => {
    const f = learnerFixture();
    try {
        f.add({ dimensions: ['memory_accessibility', 'structural_understanding', 'discrimination'] });
        const v1 = f.read();
        const old = f.graph.nodes.find(n => n.conceptId === f.root)!;
        const p = proposal(['reuse', 'new']);
        const graph = f.graphs.createDraft(f.courseId, { ...p, nodes: [{ ...p.nodes[0]!, conceptId: f.root, title: old.title, type: 'definition' }, { ...p.nodes[1]!, title: old.title, type: 'concept' }], edges: [] });
        f.graphs.activate(f.courseId, graph.version);
        const r = f.read();
        assert.equal(r.readiness.find(c => c.conceptId === f.root)!.stage, 'provisional_competence');
        const fresh = graph.nodes.find(n => n.conceptId !== f.root)!.conceptId;
        assert(r.dimensions.filter(d => d.conceptId === fresh).every(d => d.band === 'untested'));
        assert.equal(r.observations[0]!.originalVersion, 1);
        assert.equal(f.state.revision(f.courseId, v1.id).readiness.find(c => c.conceptId === f.root)!.stage, 'instructionally_ready');
    }
    finally {
        f.store.close();
    }
});
test('support/assessment metadata nodes do not receive competence; procedures require actual fluent execution evidence', () => {
    const f = learnerFixture();
    try {
        const p = proposal(['procedure', 'misconception', 'objective']);
        const graph = f.graphs.createDraft(f.courseId, { ...p, nodes: p.nodes.map((n, i) => ({ ...n, type: (['procedure', 'misconception', 'assessment_objective'] as const)[i]! })), edges: [] });
        f.graphs.activate(f.courseId, graph.version);
        const id = graph.nodes.find(n => n.type === 'procedure')!.conceptId;
        f.add({ conceptId: id, dimensions: ['structural_understanding', 'application', 'transfer'], novelty: 'near_transfer' });
        let r = f.read();
        assert.equal(r.readiness.find(c => c.conceptId === id)!.stage, 'instructionally_ready');
        assert(r.readiness.find(c => c.conceptId === id)!.missingProvisional.includes('independent_support:procedural_fluency'));
        assert(r.readiness.filter(c => c.nodeType !== 'procedure').every(c => c.stage === 'not_applicable'));
        f.add({ conceptId: id, dimensions: ['procedural_fluency'] });
        r = f.read();
        assert.equal(r.readiness.find(c => c.conceptId === id)!.stage, 'provisional_competence');
    }
    finally {
        f.store.close();
    }
});
