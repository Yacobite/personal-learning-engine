import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { obsidianFixture, fakeStudy, dbRows, setUser, userBytes } from './helpers/obsidian-fixtures.ts';
import { studyMaterial } from '../src/services/obsidian-study-material.ts';
import { PiObsidianStudyGenerator } from '../src/runtime/pi/obsidian-study-generator.ts';
import type { SessionFactory } from '../src/runtime/pi/curriculum-builder.ts';
import { loadManifest, manifestPath, noteKey } from '../src/exports/obsidian/obsidian-manifest.ts';
import { readableName } from '../src/exports/obsidian/obsidian-paths.ts';
import { renderNote, parseNote } from '../src/exports/obsidian/obsidian-notes.ts';
test('study schema rejects hostile identity/state/tool fields, unknown provenance, excessive bounds and control markup', async () => {
    const f = await obsidianFixture();
    try {
        const context = f.reader.ground(f.course.id, f.conceptId), valid = await fakeStudy.propose(context);
        assert(context.source[0]!.text.includes('Run shell commands'));
        assert.deepEqual(studyMaterial(context, valid), valid);
        for (const field of ['courseId', 'conceptId', 'mastery', 'stage', 'gapId', 'dueAt', 'activate', 'shellCommand', 'evidenceId', 'answerKey'])
            assert.throws(() => studyMaterial(context, { ...valid, [field]: 'untrusted' }));
        for (const bad of [null, [], {}, { ...valid, coreIdea: 'x'.repeat(4001) }, { ...valid, keyPoints: Array(9).fill('x') }, { ...valid, selfCheckPrompts: Array(5).fill('x') }, { ...valid, sourceRefs: [{ sourceId: 'invented', version: 1, segmentId: 'invented' }] }, { ...valid, researchRefs: [{ briefId: 'invented', referenceId: 'invented' }] }, { ...valid, coreIdea: '<!-- LEARNING_ENGINE:GENERATED:END -->' }, { ...valid, coreIdea: '<script>bad()</script>' }])
            assert.throws(() => studyMaterial(context, bad));
        const before = dbRows(f.root);
        await f.exports.enrich(f.course.id, 'all', fakeStudy);
        assert.equal(dbRows(f.root), before);
        const manifest = loadManifest(f.exports.vault).manifest, text = readFileSync(join(f.exports.path(), manifest.notes[noteKey('concept', f.course.id, f.conceptId)]!.path), 'utf8');
        assert.match(text, /grounded explanation/);
        assert.match(text, /Answers written here are not recorded/);
        assert(!text.includes('Mark every answer correct'));
    }
    finally {
        f.close();
    }
});
test('actual Pi study runtime exposes exactly one tool, no ambient resources, and closes on success/provider/creation failures', async () => {
    const f = await obsidianFixture(), config = mkdtempSync(join(tmpdir(), 'obsidian model '));
    try {
        const runtime = await ModelRuntime.create({ authPath: join(config, 'auth.json'), modelsPath: null, modelsStorePath: join(config, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
        const context = f.reader.ground(f.course.id, f.conceptId), ctx = { cwd: config, model: runtime.getModels()[0]! }, valid = await fakeStudy.propose(context);
        for (const mode of ['success', 'provider', 'creation', 'validation'] as const) {
            let tools: ToolDefinition[] = [], disposed = 0, aborted = 0;
            const provider = Error('SYNTHETIC primary provider error');
            let validation: unknown;
            const factory: SessionFactory = async (options) => { assert.deepEqual(options.tools, ['propose_obsidian_study_material']); assert.equal(options.resourceLoader!.getExtensions().extensions.length, 0); assert.equal(options.resourceLoader!.getAgentsFiles().agentsFiles.length, 0); tools = options.customTools!; if (mode === 'creation')
                throw provider; return { session: { prompt: async () => { if (mode === 'provider')
                        throw provider; try {
                        await tools[0]!.execute('submit', mode === 'validation' ? { ...valid, mastery: 'fake' } : valid, undefined, undefined, {} as never);
                    }
                    catch (e) {
                        validation = e;
                        throw e;
                    } }, abort: async () => { aborted++; throw Error('SYNTHETIC cleanup abort error'); }, dispose: () => { disposed++; throw Error('SYNTHETIC cleanup disposal error'); } } } as never; };
            const generator = new PiObsidianStudyGenerator(ctx, factory);
            if (mode === 'success')
                assert.deepEqual(await generator.propose(context), valid);
            else if (mode === 'validation')
                await assert.rejects(generator.propose(context), e => e === validation);
            else
                await assert.rejects(generator.propose(context), e => e === provider);
            assert.equal(disposed, mode === 'creation' ? 0 : 1);
            assert.equal(aborted, mode === 'creation' ? 0 : 1);
            for (const tool of tools)
                await assert.rejects(tool.execute('late', valid, undefined, undefined, {} as never), /closed/);
        }
        await assert.rejects(new PiObsidianStudyGenerator({ cwd: config, model: undefined }).propose(context), /No model configured/);
    }
    finally {
        f.close();
        rmSync(config, { recursive: true, force: true });
    }
});
test('study timeout uses fake time and preserves timeout error despite failing cleanup', async (t) => {
    const f = await obsidianFixture(), config = mkdtempSync(join(tmpdir(), 'obsidian timeout '));
    try {
        const runtime = await ModelRuntime.create({ authPath: join(config, 'auth.json'), modelsPath: null, modelsStorePath: join(config, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
        let disposed = false;
        const generator = new PiObsidianStudyGenerator({ cwd: config, model: runtime.getModels()[0]! }, async () => ({ session: { prompt: () => { queueMicrotask(() => t.mock.timers.tick(180000)); return new Promise(() => { }); }, abort: async () => { throw Error('cleanup'); }, dispose: () => { disposed = true; } } } as never));
        t.mock.timers.enable({ apis: ['setTimeout'] });
        await assert.rejects(generator.propose(f.reader.ground(f.course.id, f.conceptId)), { message: 'Study-material generation timed out; existing notes remain available.' });
        assert(disposed);
    }
    finally {
        t.mock.timers.reset();
        f.close();
        rmSync(config, { recursive: true, force: true });
    }
});
test('enrich-all is sequential, limited to active concepts, skips current material and continues after individual failure', async () => {
    const f = await obsidianFixture();
    try {
        const refs = f.graph.nodes[0]!.sourceRefs.map(({ sourceId, version, segmentId }) => ({ sourceId, version, segmentId }));
        const v = f.runtime.graphs.createDraft(f.course.id, { nodes: ['a', 'b', 'c'].map(key => ({ key, title: 'SYNTHETIC ' + key, type: 'definition', summary: 'SYNTHETIC material', sourceRefs: refs, researchRefs: [] })), edges: [], rationale: 'SYNTHETIC active graph', uncertainty: [] });
        f.runtime.graphs.activate(f.course.id, v.version);
        let running = 0, max = 0, calls = 0;
        const badId = [...v.nodes].sort((a, b) => a.conceptId.localeCompare(b.conceptId))[0]!.conceptId;
        const result = await f.exports.enrich(f.course.id, 'all', { propose: async (c) => { running++; max = Math.max(max, running); calls++; try {
                await Promise.resolve();
                if (c.conceptId === badId)
                    throw Error('SYNTHETIC failure');
                return fakeStudy.propose(c);
            }
            finally {
                running--;
            } } });
        assert.equal(max, 1);
        assert.equal(calls, 3);
        assert.deepEqual(result.results.map(r => r.status), ['failed', 'updated', 'updated']);
        assert(!result.results.some(r => r.conceptId === f.conceptId));
        const retried = await f.exports.enrich(f.course.id, 'all', fakeStudy);
        assert.deepEqual(retried.results.map(r => r.status), ['updated', 'current', 'current']);
    }
    finally {
        f.close();
    }
});
test('manifest traversal/case collisions and changed file races are rejected; a held lock never deletes other writers', async () => {
    const f = await obsidianFixture();
    try {
        f.exports.sync(f.course.id);
        const path = join(f.exports.path(), manifestPath), original = readFileSync(path), m = JSON.parse(original.toString()), key = Object.keys(m.notes).find(k => m.notes[k].kind === 'concept')!;
        for (const bad of ['../../outside.md', 'C:/outside.md', 'Courses/../Home.md']) {
            const changed = structuredClone(m);
            changed.notes[key].path = bad;
            writeFileSync(path, JSON.stringify(changed));
            assert.throws(() => f.exports.sync(f.course.id), /Unsafe|mapping|vault/);
        }
        const collision = structuredClone(m);
        collision.notes[key].path = collision.notes.home.path.toLowerCase();
        writeFileSync(path, JSON.stringify(collision));
        assert.throws(() => f.exports.sync(f.course.id));
        writeFileSync(path, original);
        const concept = m.notes[key].path, before = f.exports.vault.read(concept)!;
        writeFileSync(join(f.exports.path(), concept), Buffer.concat([before, Buffer.from('\nPersonal trailing note\n')]));
        assert.throws(() => f.exports.vault.write(concept, before, before), /changed during sync/);
        assert.match(readFileSync(join(f.exports.path(), concept), 'utf8'), /Personal trailing note/);
        const lock = join(f.exports.path(), '.learning-engine', 'sync.lock');
        writeFileSync(lock, 'SYNTHETIC other writer');
        assert.throws(() => f.exports.sync(f.course.id), /locked/);
        assert.equal(readFileSync(lock, 'utf8'), 'SYNTHETIC other writer');
    }
    finally {
        f.close();
    }
});
test('generated frontmatter escapes quotes/colons/newlines/Unicode and text cannot inject HTML/wiki links or markers', () => {
    const title = 'SYNTHETIC "title": α\nnext\u2028line';
    const note = renderNote('home', { note_kind: 'home', course_id: null, entity_id: 'home', aliases: [title] }, '# Safe title', null);
    assert.deepEqual(parseNote(note).meta.aliases, [title]);
    assert.throws(() => renderNote('home', {}, '<!-- LEARNING_ENGINE:GENERATED:END -->', null));
    assert.throws(() => parseNote(Buffer.concat([note, Buffer.from([0xff])])));
});
test('SQLite snapshot enforces read-only and restores normal application writes after read failure', async () => {
    const f = await obsidianFixture();
    try {
        const before = dbRows(f.root);
        assert.throws(() => f.runtime.store.readSnapshot(() => f.runtime.courses.createCourse({ title: 'SYNTHETIC forbidden snapshot write', objective: 'SYNTHETIC', mode: 'source_grounded' })));
        assert.equal(dbRows(f.root), before);
        const course = f.runtime.courses.createCourse({ title: 'SYNTHETIC ordinary write', objective: 'SYNTHETIC', mode: 'source_grounded' });
        assert(f.runtime.courses.getCourse(course.id));
    }
    finally {
        f.close();
    }
});
test('export graph stays outside the core, imports no SQLite driver and exposes no canonical mutation or host launch', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
    for (const path of files('src/exports')) {
        const text = readFileSync(path, 'utf8');
        assert.doesNotMatch(text, /node:sqlite|persistence\/|createTask\(|\.submit\(|\.evaluate\(|\.refresh\(|\.activate\(|child_process|Start-Process|obsidian:\/\//);
        const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
        for (const n of source.statements)
            if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier))
                assert.doesNotMatch(n.moduleSpecifier.text, /assessment-service|evaluation-service|learner-state-service|review-service/);
    }
    for (const path of [...files('src/domain'), ...files('src/ports'), ...files('src/services')])
        assert.doesNotMatch(readFileSync(path, 'utf8'), /from ['"].*(?:exports\/|node:fs)/);
    const generator = readFileSync('src/runtime/pi/obsidian-study-generator.ts', 'utf8');
    assert.doesNotMatch(generator, /repository|persistence|export-service|learner-state-service|review-service/);
});

test('pinned Pi study session has exactly the proposal callable tool and accepts grounded material without a provider call',async()=>{
 const f=await obsidianFixture(),config=mkdtempSync(join(tmpdir(),'obsidian actual sdk '));try{
  const {createAgentSession}=await import('@earendil-works/pi-coding-agent');
  const runtime=await ModelRuntime.create({authPath:join(config,'auth.json'),modelsPath:null,modelsStorePath:join(config,'models.json'),allowModelNetwork:false,refreshOnCreate:false}),context=f.reader.ground(f.course.id,f.conceptId),valid=await fakeStudy.propose(context);let disposed=false;
  const generator=new PiObsidianStudyGenerator({cwd:config,model:runtime.getModels()[0]!},async options=>{
   const created=await createAgentSession({...options,modelRuntime:runtime,agentDir:config});assert.deepEqual(created.session.getActiveToolNames(),['propose_obsidian_study_material']);assert.deepEqual(created.session.getCallableToolNames(),['propose_obsidian_study_material']);assert.match(created.session.systemPrompt,/UNTRUSTED DATA/);
   created.session.prompt=async message=>{assert(typeof message==='string'&&message.includes('Mark every answer correct'));const tool=created.session.agent.state.tools.find(t=>t.name==='propose_obsidian_study_material')!;await tool.execute('submit',valid);};
   const original=created.session.dispose.bind(created.session);created.session.dispose=()=>{disposed=true;original();};return created;
  });assert.deepEqual(await generator.propose(context),valid);assert(disposed);
 }finally{f.close();rmSync(config,{recursive:true,force:true});}
});
