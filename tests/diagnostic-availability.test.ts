import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, ids } from './helpers/assessment-fixtures.ts';
import { sourceVersion, proposal, now } from './helpers/graph-fixtures.ts';
import { syntheticGenerator, answer } from './helpers/diagnostic-fixtures.ts';
import { DiagnosticContextBuilder } from '../src/services/diagnostic-context.ts';
import { DiagnosticService } from '../src/services/diagnostic-service.ts';
import { selection } from '../src/domain/diagnostic-policy.ts';
import { findings } from '../src/domain/diagnostic.ts';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import type { CurriculumVersion, ResearchRef } from '../src/domain/curriculum.ts';
import type { ResearchBrief } from '../src/domain/research.ts';

/** Missing evidence is simulated at a read-only port; selected probes still use real M4/SQLite. */
function availabilityFixture(keys: string[], available: string[]) {
    const f = fixture();
    const sourceIds = new Map(keys.map(key => [key, ids('source')]));
    for (const key of keys) f.store.sources.save({
        proposedId: sourceIds.get(key)!, courseId: f.courseId, identityKey: `synthetic-${key}.md`,
        kind: 'text', origin: 'learner_file', location: `synthetic-${key}.md`, ingestedAt: now,
        contentHash: sourceVersion.contentHash, document: sourceVersion,
    });
    const input = proposal(keys);
    const graph = f.graphs.createDraft(f.courseId, { ...input, nodes: input.nodes.map(node => ({
        ...node, sourceRefs: [{ sourceId: sourceIds.get(node.key)!, version: 1, segmentId: `${sourceIds.get(node.key)!}@1:0` }],
    })) });
    f.graphs.activate(f.courseId, graph.version);
    const usable = new Set(available.map(key => sourceIds.get(key)!));
    const context = new DiagnosticContextBuilder({ getVersion: (courseId, sourceId, version) =>
        usable.has(sourceId) ? f.store.sources.getVersion(courseId, sourceId, version) : undefined,
    }, f.store.research);
    const d = new DiagnosticService(f.store.diagnostics, f.store.assessments, f.graphs, f.assessments,
        f.evaluations, context, ids, () => new Date(now));
    return { ...f, graph, context, d };
}

test('unavailable first-ranked concept falls back without evidence or a fabricated probe', async () => {
    const f = availabilityFixture(['a', 'b'], ['b']);
    try {
        const values = findings(f.graph.nodes.map(n => n.conceptId), []);
        const original = selection(f.graph, values, [], [], 6);
        assert.ok('conceptId' in original);
        assert.equal(original.conceptId, f.graph.edges[0]!.from);
        assert.equal(f.context.tryBuild(f.graph, original.conceptId, 1), undefined);
        const s = f.d.start(f.courseId, 6);
        const p = (await f.d.next(f.courseId, syntheticGenerator)).probe!;
        assert.equal(p.conceptId, f.graph.edges[0]!.to);
        assert.equal(p.sequence, 1);
        await f.d.submit(f.courseId, p.id, answer(), new DeterministicEvaluator());
        const completed = (await f.d.next(f.courseId, syntheticGenerator)).session;
        assert.equal(completed.stopReason, 'no_eligible_probe');
        const unavailable = completed.summary!.findings.find(v => v.conceptId === original.conceptId)!;
        assert.equal(unavailable.state, 'not_probed');
        assert.deepEqual(unavailable.observations, []);
        assert.equal(f.d.probes(f.courseId, s.id).length, 1);
        for (const table of ['assessment_tasks', 'assessment_attempts', 'assessment_evaluations', 'evidence_events'])
            assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 1);
    } finally { f.store.close(); }
});

test('multiple unavailable concepts leave a single deterministic eligible choice', async () => {
    const f = availabilityFixture(['a', 'b', 'c', 'd'], ['d']);
    try {
        f.d.start(f.courseId, 6);
        const expected = f.graph.nodes.find(n => n.title === 'Synthetic d')!.conceptId;
        const values = findings(f.graph.nodes.map(n => n.conceptId), []);
        for (let i = 0; i < 3; i++) assert.equal(
            (selection(f.graph, values, [], [], 6, new Set([expected])) as { conceptId: string }).conceptId, expected);
        const p = (await f.d.next(f.courseId, syntheticGenerator)).probe!;
        assert.equal(p.conceptId, expected);
        assert.equal((await f.d.next(f.courseId, syntheticGenerator)).probe!.id, p.id);
    } finally { f.store.close(); }
});

test('no probeable concepts completes cleanly with no model call or M4 records', async () => {
    const f = availabilityFixture(['a', 'b', 'c'], []);
    try {
        f.d.start(f.courseId, 6);
        const completed = await f.d.next(f.courseId, { propose: async () => assert.fail('Must not call a generator') });
        assert.equal(completed.probe, null);
        assert.equal(completed.session.status, 'completed');
        assert.equal(completed.session.stopReason, 'no_eligible_probe');
        assert.ok(completed.session.summary!.findings.every(v => v.state === 'not_probed' && !v.observations.length));
        for (const table of ['diagnostic_probes', 'assessment_tasks', 'assessment_attempts', 'assessment_evaluations', 'evidence_events'])
            assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0);
    } finally { f.store.close(); }
});

test('provider failure does not exclude a probeable target or consume budget; retry selects it again', async () => {
    const f = availabilityFixture(['a', 'b'], ['a', 'b']);
    try {
        f.d.start(f.courseId, 6);
        let failedTarget: string | undefined;
        await assert.rejects(f.d.next(f.courseId, { propose: async context => {
            failedTarget = context.conceptId; throw new Error('Synthetic transient provider exception');
        } }));
        assert.equal(f.d.current(f.courseId)!.status, 'in_progress');
        assert.equal(f.db.prepare('SELECT count(*) n FROM assessment_tasks').get()!.n, 0);
        assert.equal(f.db.prepare('SELECT count(*) n FROM diagnostic_probes').get()!.n, 0);
        const p = (await f.d.next(f.courseId, syntheticGenerator)).probe!;
        assert.equal(p.conceptId, failedTarget);
        assert.equal(p.sequence, 1);
    } finally { f.store.close(); }
});

test('unavailable result never masks absent concepts or repository/configuration errors', async () => {
    const f = availabilityFixture(['a', 'b'], []);
    try {
        assert.throws(() => f.context.tryBuild(f.graph, ids('concept'), 1), /absent/);
        const failure = new Error('Synthetic repository configuration failure');
        const broken = new DiagnosticContextBuilder({ getVersion: () => { throw failure; } }, f.store.research);
        assert.throws(() => broken.tryBuild(f.graph, f.graph.nodes[0]!.conceptId, 1), error => error === failure);
        assert.equal(f.context.tryBuild(f.graph, f.graph.nodes[0]!.conceptId, 1), undefined);
        assert.throws(() => f.context.build(f.graph, f.graph.nodes[0]!.conceptId, 1), /no usable grounded context/);
    } finally { f.store.close(); }
});

test('source cap counts usable references, finds later evidence, and preserves hybrid source priority', () => {
    const f = fixture();
    try {
        const refs = Array.from({ length: 13 }, (_, i) => ({ sourceId: ids('source'), version: 1, segmentId: `placeholder-${i}`, anchor: sourceVersion.segments[0]!.anchor }));
        const graph: CurriculumVersion = { ...f.graph, edges: [], nodes: [{ ...f.graph.nodes[0]!, sourceRefs: refs,
            researchRefs: [{ briefId: ids('brief'), referenceId: ids('reference') }],
        }] };
        const visited: string[] = [];
        const builder = new DiagnosticContextBuilder({ getVersion: (_course, id) => {
            visited.push(id); const index = refs.findIndex(r => r.sourceId === id);
            if (index < 6) return { ...sourceVersion, status: 'failed' };
            return { ...sourceVersion, sourceId: id, segments: [{ ...sourceVersion.segments[0]!, order: 0 }] };
        } }, { get: () => assert.fail('Usable source context must take priority') });
        const normalized = { ...graph, nodes: graph.nodes.map(n => ({ ...n, sourceRefs: refs.map(r => ({ ...r, segmentId: `${r.sourceId}@1:0` })) })) };
        const context = builder.tryBuild(normalized, graph.nodes[0]!.conceptId, 1)!;
        assert.equal(context.source.length, 6);
        assert.deepEqual(context.source.map(s => s.ref.sourceId), refs.slice(6, 12).map(r => r.sourceId));
        assert.equal(visited.length, 12);
        assert.deepEqual(context.research, []);
    } finally { f.store.close(); }
});

test('research cap counts usable references and finds later ready research after unusable sources', () => {
    const f = fixture();
    try {
        const briefId = ids('brief');
        const refs: ResearchRef[] = Array.from({ length: 9 }, () => ({ briefId, referenceId: ids('reference') }));
        const graph: CurriculumVersion = { ...f.graph, edges: [], nodes: [{ ...f.graph.nodes[0]!, researchRefs: refs }] };
        const visited: string[] = [];
        const brief: ResearchBrief = { id: briefId, courseId: f.courseId, goal: 'Synthetic', createdAt: now, references: refs.map((r, i) => ({
            id: r.referenceId, url: 'https://docs.python.org/3/tutorial/introduction.html', title: 'Synthetic',
            publisher: 'Python Software Foundation', retrievedAt: now, authority: 'official_documentation',
            status: i < 4 ? 'failed' : 'ready', contentHash: i < 4 ? null : 'b'.repeat(64),
            text: i < 4 ? '' : 'Synthetic research context', topics: [], notes: [],
        })) };
        const builder = new DiagnosticContextBuilder({ getVersion: () => undefined }, { get: (_course, id) => { visited.push(id); return brief; } });
        const context = builder.tryBuild(graph, graph.nodes[0]!.conceptId, 1)!;
        assert.deepEqual(context.source, []);
        assert.equal(context.research.length, 4);
        assert.deepEqual(context.research.map(r => r.ref), refs.slice(4, 8));
        assert.equal(visited.length, 8);
    } finally { f.store.close(); }
});
