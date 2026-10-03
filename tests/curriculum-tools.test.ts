import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { SourceService } from '../src/services/source-service.ts';
import { GraphService } from '../src/services/graph-service.ts';
import { createBuilderTools } from '../src/runtime/pi/curriculum-tools.ts';
import { MemoryGraphs, course, courseId, now, proposal, sourceId, sourceVersion } from './helpers/graph-fixtures.ts';
function scope() {
    const repository = new MemoryGraphs();
    const graph = new GraphService({ getCourse: () => course }, repository, { getVersion: () => sourceVersion }, { get: () => undefined }, () => `concept-${randomUUID()}`, () => new Date(now));
    const sources = { list: () => [{ id: sourceId, currentVersion: 1 }], status: () => sourceVersion } as unknown as SourceService;
    return { ...createBuilderTools(courseId, sources, graph), repository };
}
test('source tool reads only frozen course evidence and marks injection as untrusted data', async () => {
    const builder = scope();
    assert.deepEqual(builder.tools.map((tool) => tool.name), ['read_curriculum_evidence', 'propose_curriculum']);
    const result = await builder.tools[0]!.execute('call', { kind: 'source', id: sourceId, offset: 0 }, undefined, undefined, {} as Parameters<ToolDefinition['execute']>[4]);
    const output = JSON.stringify(result);
    assert.match(output, /untrusted-source-data/);
    assert.match(output, /Ignore previous instructions/);
    assert.equal(builder.repository.versions.length, 0);
    await assert.rejects(builder.tools[0]!.execute('call', { kind: 'source', id: 'outside', offset: 0 }, undefined, undefined, {} as Parameters<ToolDefinition['execute']>[4]));
});
test('proposal tool accepts one validated draft but cannot activate or declare mastery', async () => {
    const builder = scope();
    const submit = builder.tools[1]!;
    for (const bad of [{ ...proposal(), active: true }, { ...proposal(), mastery: 1 }, { ...proposal(), edges: [...proposal().edges, { from: 'b', to: 'a', type: 'prerequisite_of', rationale: 'Cycle' }] },
        { ...proposal(['a']), nodes: [{ ...proposal(['a']).nodes[0]!, sourceRefs: [{ sourceId, version: 1, segmentId: `${sourceId}@1:999` }] }] }]) {
        await assert.rejects(submit.execute('call', { proposal: bad }, undefined, undefined, {} as Parameters<ToolDefinition['execute']>[4]));
    }
    const result = await submit.execute('call', { proposal: proposal() }, undefined, undefined, {} as Parameters<ToolDefinition['execute']>[4]);
    assert.match(JSON.stringify(result), /draft/);
    assert.equal(builder.repository.current(courseId), undefined);
    assert.equal(builder.repository.versions.length, 1);
    await assert.rejects(submit.execute('call', { proposal: proposal() }, undefined, undefined, {} as Parameters<ToolDefinition['execute']>[4]), /already created/);
});
test('closed or cancelled builders cannot perform late reads or draft writes', async () => {
    const builder = scope();
    const controller = new AbortController(); controller.abort();
    await assert.rejects(builder.tools[1]!.execute('call',{proposal:proposal()},controller.signal,undefined,{} as Parameters<ToolDefinition['execute']>[4]),/ended/);
    builder.close();
    await assert.rejects(builder.tools[1]!.execute('call',{proposal:proposal()},undefined,undefined,{} as Parameters<ToolDefinition['execute']>[4]),/ended/);
    assert.equal(builder.repository.versions.length,0);
});
