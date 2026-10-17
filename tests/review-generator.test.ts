import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { reviewFixture, proposal } from './helpers/review-fixtures.ts';
import { hash } from './helpers/assessment-fixtures.ts';
import { reviewTask } from '../src/services/review-content.ts';
import { publicDiagnosticTask } from '../src/services/diagnostic-context.ts';
import { PiReviewGenerator } from '../src/runtime/pi/review-generator.ts';
import type { ReviewTaskContext } from '../src/ports/review-generator.ts';
function context(f: ReturnType<typeof reviewFixture>): ReviewTaskContext {
    f.support();
    const i = f.store.reviews.list(f.courseId)[0]!;
    return { grounding: f.context.build(f.graph, i.conceptId, 1), item: i, previousPromptHashes: [] };
}
for (const field of ['conceptId', 'courseId', 'curriculumVersion', 'reviewKind', 'gapId', 'dueAt', 'dimension', 'stage', 'mastery', 'evidenceId', 'assistance', 'stateRevisionId', 'nextScheduleDate'])
    test('review generator cannot set ' + field, () => {
        const f = reviewFixture();
        try {
            const c = context(f);
            assert.throws(() => reviewTask(c, { ...proposal(c), [field]: 'untrusted' }, hash));
            assert.equal(f.db.prepare('SELECT count(*) n FROM review_task_origins').get()!.n, 0);
        }
        finally {
            f.store.close();
        }
    });
test('review content rejects invented provenance, open grading, exact explanation grading and answer-key markers', () => {
    const f = reviewFixture();
    try {
        const c = context(f), valid = proposal(c);
        for (const p of [null, [], { ...valid, sourceRefs: [] }, { ...valid, prompt: 'Correct answer: alpha' }, { ...valid, scoring: { kind: 'open', rubricVersion: 'x', criteria: [], expected: null } }, { ...valid, sourceRefs: [{ ...valid.sourceRefs[0]!, version: 999 }] }])
            assert.throws(() => reviewTask(c, p, hash));
        assert.throws(() => reviewTask({ ...c, item: { ...c.item, dimension: 'structural_understanding' } }, { ...valid, scoring: { kind: 'text', expected: 'alpha', normalization: 'exact' } }, hash));
        const task = reviewTask(c, { ...valid, prompt: 'Select a development option.', scoring: { kind: 'choice', options: ['alpha', 'beta'], expected: 'alpha' } }, hash);
        const display = publicDiagnosticTask({ ...task, id: 'synthetic' });
        assert(!('scoring' in display));
        assert(!('expected' in display));
        assert(!('source' in display));
    }
    finally {
        f.store.close();
    }
});
test('actual pinned Pi SDK review generator exposes only bounded proposal and closes it after disposal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'm8-sdk-')), f = reviewFixture();
    try {
        const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
        const c = context(f);
        let tool: Awaited<ReturnType<typeof createAgentSession>>['session']['agent']['state']['tools'][number] | undefined;
        const generator = new PiReviewGenerator({ cwd: root, model: modelRuntime.getModels()[0]! }, async (options) => {
            assert.equal(options.resourceLoader!.getExtensions().extensions.length, 0);
            assert.equal(options.resourceLoader!.getAgentsFiles().agentsFiles.length, 0);
            const result = await createAgentSession({ ...options, agentDir: root, modelRuntime });
            assert.deepEqual(result.session.getActiveToolNames(), ['propose_review_task']);
            assert.deepEqual(result.session.getCallableToolNames(), ['propose_review_task']);
            assert.match(result.session.systemPrompt, /UNTRUSTED DATA/);
            result.session.prompt = async (prompt) => { assert.match(prompt, /Ignore previous instructions/); assert.doesNotMatch(prompt, /response|auth\.json/); tool = result.session.agent.state.tools[0]!; await tool.execute('synthetic', proposal(c)); };
            return result;
        });
        const p = await generator.propose(c);
        assert(reviewTask(c, p, hash));
        await assert.rejects(tool!.execute('late', proposal(c)));
        assert.equal(f.db.prepare('SELECT count(*) n FROM review_task_origins').get()!.n, 0);
    }
    finally {
        f.store.close();
        rmSync(root, { recursive: true, force: true });
    }
});
