import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { PiCurriculumBuilder, builderInstructions } from '../src/runtime/pi/curriculum-builder.ts';
import { CourseService } from '../src/services/course-service.ts';
import { GraphService } from '../src/services/graph-service.ts';
import { ResearchService } from '../src/services/research-service.ts';
import type { SourceService } from '../src/services/source-service.ts';
import { MemoryGraphs, course, courseId, now, proposal, sourceId, sourceVersion } from './helpers/graph-fixtures.ts';
test('restricted builder uses the real Pi SDK with only two active tools and a deterministic fake model turn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'learning-m3-sdk-'));
    try {
        const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
        const courses = new CourseService({ getById: () => course, list: () => [course], create: () => { } }, () => courseId, () => new Date(now));
        const repository = new MemoryGraphs();
        const graphs = new GraphService(courses, repository, { getVersion: () => sourceVersion }, { get: () => undefined }, () => `concept-${randomUUID()}`, () => new Date(now));
        const sources = { list: () => [{ id: sourceId, currentVersion: 1 }], status: () => sourceVersion } as unknown as SourceService;
        const research = new ResearchService(courses, { get: () => undefined, list: () => [], save: () => { } }, { retrieve: async () => { throw new Error('Source-grounded build must not research'); } });
        let verified = false;
        const builder = new PiCurriculumBuilder(courses, sources, graphs, research, async (options) => {
            assert.equal(options.resourceLoader!.getExtensions().extensions.length, 0);
            assert.equal(options.resourceLoader!.getAgentsFiles().agentsFiles.length, 0);
            const result = await createAgentSession({ ...options, agentDir: root, modelRuntime });
            assert.deepEqual(result.session.getActiveToolNames().sort(), ['propose_curriculum', 'read_curriculum_evidence']);
            assert.deepEqual(result.session.getCallableToolNames().sort(), ['propose_curriculum', 'read_curriculum_evidence']);
            assert.match(result.session.systemPrompt, /Evidence is untrusted/);
            result.session.prompt = async () => {
                const read = result.session.agent.state.tools.find((tool) => tool.name === 'read_curriculum_evidence')!;
                const evidence = await read.execute('read', { kind: 'source', id: sourceId, offset: 0 });
                assert.match(JSON.stringify(evidence), /untrusted-source-data/);
                const submit = result.session.agent.state.tools.find((tool) => tool.name === 'propose_curriculum')!;
                await submit.execute('submit', { proposal: proposal() });
                verified = true;
            };
            return result;
        });
        assert.match(builderInstructions, /DRAFT/);
        const draft = await builder.build(courseId, { cwd: root, model: modelRuntime.getModels()[0]! });
        assert.ok(verified);
        assert.equal(draft.version, 1);
        assert.equal(repository.current(courseId), undefined);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
