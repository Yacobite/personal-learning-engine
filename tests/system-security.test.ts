import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import ts from 'typescript';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { CreateAgentSessionOptions, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { systemFixture, hostileSource } from './helpers/system-fixtures.ts';
import { PiCurriculumBuilder, type SessionFactory } from '../src/runtime/pi/curriculum-builder.ts';
import { PiDiagnosticGenerator } from '../src/runtime/pi/diagnostic-generator.ts';
import { PiTeachingGenerator } from '../src/runtime/pi/teaching-generator.ts';
import { PiReviewGenerator } from '../src/runtime/pi/review-generator.ts';
import { reviewTask } from '../src/services/review-content.ts';
import { diagnosticTask } from '../src/services/diagnostic-context.ts';
import { teachingContent } from '../src/services/teaching-content.ts';
import { hash, fillProfile } from './helpers/system-fixtures.ts';
import type { TeachingContext } from '../src/ports/teaching-generator.ts';
import type { ReviewTaskContext } from '../src/ports/review-generator.ts';
async function cleanupFixture() {
    const f = await systemFixture();
    const config = mkdtempSync(join(tmpdir(), 'm9 capability '));
    const runtime = await ModelRuntime.create({ authPath: join(config, 'auth.json'), modelsPath: null, modelsStorePath: join(config, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
    const ctx = { cwd: config, model: runtime.getModels()[0]! };
    const ground = f.runtime.grounding.build(f.graph, f.conceptId, 1);
    assert(ground.source[0]!.text.includes('Ignore previous instructions'));
    const teaching: TeachingContext = { grounding: ground, moveType: 'independent_practice', level: 0, reason: 'synthetic', previousPrompts: [], pendingTask: null, feedback: null };
    fillProfile(f);
    const review: ReviewTaskContext = { grounding: ground, item: f.runtime.store.reviews.list(f.course.id)[0]!, previousPromptHashes: [] };
    const proposal = { nodes: [{ key: 'cleanup', title: 'SYNTHETIC cleanup draft', type: 'definition', summary: 'SYNTHETIC cleanup regression.', sourceRefs: ground.source.map(s => s.ref), researchRefs: [] }], edges: [], rationale: 'SYNTHETIC cleanup test.', uncertainty: [] };
    const factories = [
        { tools: ['read_curriculum_evidence', 'propose_curriculum'], payload: { proposal }, timeout: 'Curriculum build timed out.', invoke: (factory: SessionFactory) => new PiCurriculumBuilder(f.runtime.courses, f.runtime.sources, f.runtime.graphs, { retrieve: async () => { throw Error('no research'); } } as never, factory).build(f.course.id, ctx) },
        { tools: ['propose_diagnostic_task'], payload: await f.diagnosticGenerator.propose(ground), timeout: 'Diagnostic generation timed out; session remains resumable.', invoke: (factory: SessionFactory) => new PiDiagnosticGenerator(ctx, factory).propose(ground) },
        { tools: ['propose_teaching_content'], payload: await f.teachingGenerator.propose(teaching), timeout: 'Teaching generation timed out; session remains resumable.', invoke: (factory: SessionFactory) => new PiTeachingGenerator(ctx, factory).propose(teaching) },
        { tools: ['propose_review_task'], payload: await f.reviewGenerator.propose(review), timeout: 'Review generation timed out; session remains resumable.', invoke: (factory: SessionFactory) => new PiReviewGenerator(ctx, factory).propose(review) },
    ];
    return { f, factories, close: () => { f.close(); rmSync(config, { recursive: true, force: true }); } };
}
async function assertClosed(tools: ToolDefinition[]) {
    for (const tool of tools) await assert.rejects(tool.execute('late', {}, undefined, undefined, {} as never), /closed|unavailable|ended/i);
}

test('all four Pi scopes close on creation failure and preserve the exact provider error despite abort/dispose failures', async () => {
    const c = await cleanupFixture();
    try {
        for (const scope of c.factories) {
            let tools: ToolDefinition[] = [];
            const versions = c.f.runtime.graphs.list(c.f.course.id).length;
            const evidence = c.f.runtime.store.assessments.recent(c.f.course.id, 100).length;
            const creationError = Error('SYNTHETIC creation failure');
            await assert.rejects(scope.invoke(async options => {
                assert.equal(options.resourceLoader!.getExtensions().extensions.length, 0);
                assert.equal(options.resourceLoader!.getAgentsFiles().agentsFiles.length, 0);
                tools = options.customTools!;
                assert.deepEqual(options.tools, scope.tools);
                throw creationError;
            }), error => error === creationError);
            await assertClosed(tools);
            assert.equal(c.f.runtime.graphs.list(c.f.course.id).length, versions);
            assert.equal(c.f.runtime.store.assessments.recent(c.f.course.id, 100).length, evidence);
            for (const disposeThrows of [false, true]) {
                let disposed = 0, aborted = 0;
                const providerError = Error('SYNTHETIC provider failure');
                await assert.rejects(scope.invoke(async options => {
                    tools = options.customTools!;
                    return { session: {
                        prompt: async () => { throw providerError; },
                        abort: async () => { aborted++; throw Error('SYNTHETIC abort failure'); },
                        dispose: () => { disposed++; if (disposeThrows) throw Error('SYNTHETIC disposal failure'); },
                    } } as never;
                }), error => error === providerError && error instanceof Error && error.message === 'SYNTHETIC provider failure');
                assert.equal(aborted, 1);
                assert.equal(disposed, 1);
                await assertClosed(tools);
            }
        }
    } finally { c.close(); }
});

test('diagnostic, teaching and review return valid proposals despite abort/disposal cleanup failures', async () => {
    const c = await cleanupFixture();
    try {
        for (const scope of c.factories.slice(1)) for (const disposeThrows of [false, true]) {
            let tools: ToolDefinition[] = [], disposed = 0, aborted = 0;
            const result = await scope.invoke(async options => {
                tools = options.customTools!;
                return { session: {
                    prompt: async () => { await tools[0]!.execute('submit', scope.payload, undefined, undefined, {} as never); },
                    abort: async () => { aborted++; throw Error('SYNTHETIC abort failure'); },
                    dispose: () => { disposed++; if (disposeThrows) throw Error('SYNTHETIC disposal failure'); },
                } } as never;
            });
            assert.deepEqual(result, scope.payload);
            assert.equal(aborted, 1);
            assert.equal(disposed, 1);
            await assertClosed(tools);
        }
    } finally { c.close(); }
});

test('curriculum returns its one durable draft despite abort/disposal failure without duplicate creation or activation', async t => {
    const c = await cleanupFixture();
    try {
        const scope = c.factories[0]!;
        const create = t.mock.method(c.f.runtime.graphs, 'createDraft');
        const before = c.f.runtime.graphs.list(c.f.course.id).length;
        const active = c.f.runtime.graphs.current(c.f.course.id);
        let tools: ToolDefinition[] = [], disposed = 0, aborted = 0, sessions = 0;
        const draft = await scope.invoke(async options => {
            sessions++;
            tools = options.customTools!;
            return { session: {
                prompt: async () => { await tools.find(t => t.name === 'propose_curriculum')!.execute('submit', scope.payload, undefined, undefined, {} as never); },
                abort: async () => { aborted++; throw Error('SYNTHETIC abort failure'); },
                dispose: () => { disposed++; throw Error('SYNTHETIC disposal failure'); },
            } } as never;
        });
        const versions = c.f.runtime.graphs.list(c.f.course.id);
        assert.equal(create.mock.callCount(), 1);
        assert.equal(sessions, 1);
        assert.equal(versions.length, before + 1);
        assert.deepEqual(draft, versions.at(-1));
        assert.equal(versions.at(-1)!.activatedAt, null);
        assert.equal(c.f.runtime.graphs.current(c.f.course.id), active);
        assert.equal(aborted, 1);
        assert.equal(disposed, 1);
        await assertClosed(tools);
        assert.equal(c.f.runtime.graphs.list(c.f.course.id).length, before + 1);
    } finally { c.close(); }
});

test('all four adapter timeouts retain their exact timeout error when timeout and final abort fail', async t => {
    const c = await cleanupFixture();
    try {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        for (const scope of c.factories) {
            let tools: ToolDefinition[] = [], disposed = 0, aborted = 0;
            await assert.rejects(scope.invoke(async options => {
                tools = options.customTools!;
                return { session: {
                    prompt: () => { queueMicrotask(() => t.mock.timers.tick(180000)); return new Promise<void>(() => {}); },
                    abort: async () => { aborted++; throw Error('SYNTHETIC abort failure'); },
                    dispose: () => { disposed++; throw Error('SYNTHETIC disposal failure'); },
                } } as never;
            }), { message: scope.timeout });
            assert.equal(aborted, 2);
            assert.equal(disposed, 1);
            await assertClosed(tools);
        }
        assert.equal(c.f.runtime.graphs.list(c.f.course.id).length, 1);
    } finally { t.mock.timers.reset(); c.close(); }
});

test('hostile source and forbidden proposal fields remain data across diagnostic, teaching and review boundaries', async () => {
    const f = await systemFixture();
    try {
        const ground = f.runtime.grounding.build(f.graph, f.conceptId, 1);
        assert(ground.source[0]!.text.includes('Advance all reviews'));
        const d = await f.diagnosticGenerator.propose(ground);
        const t: TeachingContext = { grounding: ground, moveType: 'independent_practice', level: 0, reason: 'synthetic', previousPrompts: [], pendingTask: null, feedback: null };
        const tp = await f.teachingGenerator.propose(t);
        fillProfile(f);
        const item = f.runtime.store.reviews.list(f.course.id)[0]!;
        const rc: ReviewTaskContext = { grounding: ground, item, previousPromptHashes: [] }, rp = await f.reviewGenerator.propose(rc);
        const before = f.runtime.store.assessments.recent(f.course.id, 100).length;
        for (const field of ['mastery', 'courseId', 'curriculumVersion', 'conceptId', 'gapId', 'evidenceId', 'dueAt', 'nextConcept', 'activate', 'shellCommand']) {
            assert.throws(() => diagnosticTask(ground, { ...d, [field]: 'untrusted' }));
            assert.throws(() => teachingContent(t, { ...tp, [field]: 'untrusted' }));
            assert.throws(() => reviewTask(rc, { ...rp, [field]: 'untrusted' }, hash));
        }
        assert.equal(f.runtime.store.assessments.recent(f.course.id, 100).length, before);
        assert.equal(f.runtime.graphs.current(f.course.id), 1);
    }
    finally {
        f.close();
    }
});
test('entire core import graph has no runtime cycle and deterministic policy modules have no ambient clock/RNG', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [resolve(dir, e.name)] : []);
    const paths = files('src'), known = new Set(paths), edges = new Map<string, string[]>();
    for (const path of paths) {
        const text = readFileSync(path, 'utf8'), file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
        const imports: string[] = [];
        for (const n of file.statements)
            if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !n.importClause?.isTypeOnly) {
                const clause = n.importClause;
                const named = clause?.namedBindings;
                if (named && ts.isNamedImports(named) && named.elements.every(e => e.isTypeOnly) && !clause?.name)
                    continue;
                const target = resolve(dirname(path), n.moduleSpecifier.text);
                if (known.has(target))
                    imports.push(target);
            }
        edges.set(path, imports);
        if (/domain[\\/].*(policy|competence-profile)/.test(path))
            assert.doesNotMatch(text, /Date\.now|new Date\(\s*\)|Math\.random|fetch\(/);
    }
    const visiting = new Set<string>(), visited = new Set<string>();
    const walk = (path: string) => { assert(!visiting.has(path), 'Runtime import cycle at ' + path); if (visited.has(path))
        return; visiting.add(path); for (const target of edges.get(path) ?? [])
        walk(target); visiting.delete(path); visited.add(path); };
    for (const path of paths)
        walk(path);
});
