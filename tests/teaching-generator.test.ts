import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fixture } from './helpers/assessment-fixtures.ts';
import { proposal } from './helpers/teaching-fixtures.ts';
import { DiagnosticContextBuilder } from '../src/services/diagnostic-context.ts';
import { teachingContent } from '../src/services/teaching-content.ts';
import { PiTeachingGenerator } from '../src/runtime/pi/teaching-generator.ts';
import type { TeachingContext } from '../src/ports/teaching-generator.ts';
test('real pinned SDK generator has exactly one proposal tool, no ambient resources or write capability', async () => {
    const root = mkdtempSync(join(tmpdir(), 'm6-sdk-'));
    const f = fixture();
    try {
        const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
        const context: TeachingContext = { grounding: new DiagnosticContextBuilder(f.store.sources, f.store.research).build(f.graph, f.graph.nodes[0]!.conceptId, 1), moveType: 'activate_prior_knowledge', level: 0, reason: 'question_first', previousPrompts: [], pendingTask: null };
        let capturedTool: Awaited<ReturnType<typeof createAgentSession>>['session']['agent']['state']['tools'][number] | undefined;
        const generator = new PiTeachingGenerator({ cwd: root, model: modelRuntime.getModels()[0]! }, async (options) => { assert.equal(options.resourceLoader!.getExtensions().extensions.length, 0); assert.equal(options.resourceLoader!.getAgentsFiles().agentsFiles.length, 0); const result = await createAgentSession({ ...options, agentDir: root, modelRuntime }); assert.deepEqual(result.session.getActiveToolNames(), ['propose_teaching_content']); assert.deepEqual(result.session.getCallableToolNames(), ['propose_teaching_content']); assert.match(result.session.systemPrompt, /UNTRUSTED DATA/); result.session.prompt = async (prompt) => { assert.match(prompt, /Ignore previous instructions/); assert.doesNotMatch(prompt, /learner.*response|priorAttemptIds|auth\.json/); capturedTool = result.session.agent.state.tools[0]!; await capturedTool.execute('synthetic', proposal(context)); }; return result; });
        const output = await generator.propose(context);
        assert.ok(teachingContent(context, output));
        assert.equal(f.db.prepare('SELECT count(*) n FROM assessment_tasks').get()!.n, 0);
        await assert.rejects(capturedTool!.execute('late', proposal(context)));
    }
    finally {
        f.store.close();
        rmSync(root, { recursive: true, force: true });
    }
});
