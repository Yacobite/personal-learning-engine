import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fixture } from './helpers/assessment-fixtures.ts';
import { syntheticGenerator, diagnostics } from './helpers/diagnostic-fixtures.ts';
import { DiagnosticContextBuilder, diagnosticTask, publicDiagnosticTask } from '../src/services/diagnostic-context.ts';
import { PiDiagnosticGenerator } from '../src/runtime/pi/diagnostic-generator.ts';
for (const field of ['courseId', 'curriculumVersion', 'conceptIds', 'nextConcept', 'assistance', 'evidence', 'mastery', 'stopReason'])
    test(`generator cannot inject ${field}`, async () => { const f = fixture(); try {
        const d = diagnostics(f);
        d.start(f.courseId, 1);
        await assert.rejects(d.next(f.courseId, { propose: async (c) => ({ ...await syntheticGenerator.propose(c) as object, [field]: 'malicious' }) }));
        assert.equal(f.db.prepare('SELECT count(*) n FROM diagnostic_probes').get()!.n, 0);
        assert.equal(f.db.prepare('SELECT count(*) n FROM assessment_tasks').get()!.n, 0);
    }
    finally {
        f.store.close();
    } });
test('invented provenance, open scoring, malformed content and answer-key marker are rejected', async () => { const f = fixture(); try {
    const context = new DiagnosticContextBuilder(f.store.sources, f.store.research).build(f.graph, f.graph.nodes[0]!.conceptId, 1);
    const valid = await syntheticGenerator.propose(context) as Record<string, unknown>;
    for (const value of [null, [], { ...valid, prompt: 4 }, { ...valid, prompt: 'Correct answer: alpha' }, { ...valid, sourceRefs: [{ ...context.source[0]!.ref, version: 999 }] }, { ...valid, scoring: { kind: 'open', rubricVersion: 'synthetic', criteria: [{ key: 'x', description: 'Synthetic' }], expected: null } }])
        assert.throws(() => diagnosticTask(context, value));
    const input = diagnosticTask(context, valid);
    const display = publicDiagnosticTask({ ...input, id: 'synthetic' });
    assert.equal('scoring' in display, false);
    assert.equal(JSON.stringify(display).includes('alpha'), false);
    assert.equal('source' in display, false);
    assert.equal('summary' in display, false);
}
finally {
    f.store.close();
} });
test('provider failure and repeated exact prompt leave session resumable without extra task', async () => { const f = fixture(); try {
    const d = diagnostics(f);
    d.start(f.courseId, 2);
    await assert.rejects(d.next(f.courseId, { propose: async () => { throw Error('synthetic unavailable'); } }));
    const first = (await d.next(f.courseId, syntheticGenerator)).probe!;
    d.skip(f.courseId, first.id);
    await assert.rejects(d.next(f.courseId, { propose: async (c) => ({ ...await syntheticGenerator.propose(c) as object, prompt: f.assessments.task(f.courseId, first.taskId).prompt }) }));
    assert.equal(f.db.prepare('SELECT count(*) n FROM assessment_tasks').get()!.n, 1);
    assert.equal(d.current(f.courseId)!.status, 'in_progress');
}
finally {
    f.store.close();
} });
test('real pinned SDK generator has exactly one proposal tool, no ambient resources or write capability', async () => { const root = mkdtempSync(join(tmpdir(), 'm5-sdk-')); const f = fixture(); try {
    const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
    const context = new DiagnosticContextBuilder(f.store.sources, f.store.research).build(f.graph, f.graph.nodes[0]!.conceptId, 1);
    let capturedTool: Awaited<ReturnType<typeof createAgentSession>>['session']['agent']['state']['tools'][number] | undefined;
    const generator = new PiDiagnosticGenerator({ cwd: root, model: modelRuntime.getModels()[0]! }, async (options) => { assert.equal(options.resourceLoader!.getExtensions().extensions.length, 0); assert.equal(options.resourceLoader!.getAgentsFiles().agentsFiles.length, 0); const result = await createAgentSession({ ...options, agentDir: root, modelRuntime }); assert.deepEqual(result.session.getActiveToolNames(), ['propose_diagnostic_task']); assert.deepEqual(result.session.getCallableToolNames(), ['propose_diagnostic_task']); assert.match(result.session.systemPrompt, /UNTRUSTED DATA/); result.session.prompt = async (prompt) => { assert.match(prompt, /Ignore previous instructions/); assert.doesNotMatch(prompt, /learner.*response|priorAttemptIds|auth\.json/); capturedTool = result.session.agent.state.tools[0]!; await capturedTool.execute('synthetic', await syntheticGenerator.propose(context)); }; return result; });
    const output = await generator.propose(context);
    assert.ok(diagnosticTask(context, output));
    assert.equal(f.db.prepare('SELECT count(*) n FROM assessment_tasks').get()!.n, 0);
    await assert.rejects(capturedTool!.execute('late', await syntheticGenerator.propose(context)));
}
finally {
    f.store.close();
    rmSync(root, { recursive: true, force: true });
} });
