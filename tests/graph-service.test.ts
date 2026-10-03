import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { GraphService } from '../src/services/graph-service.ts';
import { MemoryGraphs, course, courseId, now, proposal, sourceId, sourceVersion } from './helpers/graph-fixtures.ts';
function context() {
    const repository = new MemoryGraphs();
    const versions = new Map([[1, sourceVersion]]);
    const service = new GraphService({ getCourse: (id) => { assert.equal(id, courseId); return course; } }, repository, { getVersion: (owner, id, version) => owner === courseId && id === sourceId ? versions.get(version) : undefined }, { get: () => undefined }, () => `concept-${randomUUID()}`, () => new Date(now));
    return { service, repository, versions };
}
test('fake ports create drafts, preserve identity on rebuild, and explicitly activate without Pi or SQLite', () => {
    const { service, repository } = context();
    const first = service.createDraft(courseId, proposal());
    assert.equal(service.current(courseId), undefined);
    service.activate(courseId, 1);
    const next = proposal();
    const second = service.createDraft(courseId, { ...next, nodes: next.nodes.map((node, index) => ({ ...node, title: 'Improved title', conceptId: first.nodes[index]!.conceptId })) });
    assert.equal(second.version, 2);
    assert.equal(service.current(courseId), 1);
    assert.deepEqual(first.nodes.map((n) => n.conceptId), second.nodes.map((n) => n.conceptId));
    assert.equal(repository.concepts.size, 2);
    service.activate(courseId, 2);
    assert.equal(service.current(courseId), 2);
    assert.equal(service.get(courseId, 1).nodes[0]!.title, 'Synthetic a');
    assert.equal(service.inspect(courseId, second.nodes[1]!.conceptId).prerequisites[0], second.nodes[0]!.conceptId);
    assert.equal(service.inspect(courseId, second.nodes[0]!.conceptId).dependents[0], second.nodes[1]!.conceptId);
});
test('new concepts have new IDs; invented/cross-course reuse and invalid curriculum identities fail', () => {
    const { service, repository } = context();
    const first = service.createDraft(courseId, proposal(['a']));
    const second = service.createDraft(courseId, proposal(['a']));
    assert.notEqual(first.nodes[0]!.conceptId, second.nodes[0]!.conceptId);
    const id = `concept-${randomUUID()}`;
    repository.concepts.set(id, { id, courseId: 'different-course', createdAt: now });
    assert.throws(() => service.createDraft(courseId, { ...proposal(['a']), nodes: [{ ...proposal(['a']).nodes[0]!, conceptId: id }] }), /belong/);
    for (const version of [0, -1, 1.5, NaN, 999])
        assert.throws(() => service.get(courseId, version));
    assert.throws(() => service.inspect(courseId, '../bad', 1));
});
test('source provenance validates exact version, segment and ownership; history remains anchored to v1', () => {
    const { service, repository, versions } = context();
    const first = service.createDraft(courseId, proposal());
    versions.set(2, { ...sourceVersion, version: 2, segments: [{ ...sourceVersion.segments[0]!, text: 'Updated definition', anchor: { kind: 'text', startOffset: 100, endOffset: 200 } }] });
    for (const ref of [{ sourceId: `source-${randomUUID()}`, version: 1, segmentId: 'placeholder' },
        { sourceId, version: 99, segmentId: `${sourceId}@99:0` }, { sourceId, version: 1, segmentId: `${sourceId}@1:99` }]) {
        const actual = { ...ref, segmentId: ref.segmentId === 'placeholder' ? `${ref.sourceId}@1:0` : ref.segmentId };
        assert.throws(() => service.createDraft(courseId, { ...proposal(['a']), nodes: [{ ...proposal(['a']).nodes[0]!, sourceRefs: [actual] }] }));
    }
    assert.equal(repository.versions.length, 1);
    assert.deepEqual(service.get(courseId, 1).nodes[0]!.sourceRefs, first.nodes[0]!.sourceRefs);
});
test('generated graphs require successful research, and failed references cannot ground nodes', () => {
    const repository = new MemoryGraphs();
    const briefId = `brief-${randomUUID()}`;
    const referenceId = `reference-${randomUUID()}`;
    let ready = false;
    const service = new GraphService({ getCourse: () => ({ ...course, mode: 'generated_curriculum' }) }, repository, { getVersion: () => undefined }, { get: (owner, id) => owner === courseId && id === briefId ? { id: briefId, courseId, goal: 'Python', createdAt: now, references: [{ id: referenceId, url: 'https://docs.python.org/3/tutorial/introduction.html', title: 'Python', publisher: 'Python Software Foundation', retrievedAt: now, contentHash: ready ? 'b'.repeat(64) : null, authority: 'official_documentation', status: ready ? 'ready' : 'failed', text: ready ? 'Actual synthetic evidence' : '', topics: [], notes: [] }] } : undefined }, () => `concept-${randomUUID()}`, () => new Date(now));
    const input = { ...proposal(['a']), nodes: [{ ...proposal(['a']).nodes[0]!, sourceRefs: [], researchRefs: [{ briefId, referenceId }] }] };
    assert.throws(() => service.createDraft(courseId, input), /successfully/);
    ready = true;
    assert.equal(service.createDraft(courseId, input).version, 1);
    assert.throws(() => service.createDraft(courseId, proposal()), /research provenance only/);
});
