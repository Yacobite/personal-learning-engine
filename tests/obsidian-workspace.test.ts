import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, unlinkSync, renameSync, mkdirSync, symlinkSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obsidianFixture, dbRows, setUser, userBytes, noteFiles, fileState, fakeStudy } from './helpers/obsidian-fixtures.ts';
import { fillProfile, finishInstruction, day } from './helpers/system-fixtures.ts';
import { ObsidianExportService } from '../src/exports/obsidian/obsidian-export-service.ts';
import { SafeVault, readableName } from '../src/exports/obsidian/obsidian-paths.ts';
import { loadManifest, noteKey, manifestPath } from '../src/exports/obsidian/obsidian-manifest.ts';
import { markers, parseNote } from '../src/exports/obsidian/obsidian-notes.ts';
import { buildPlans } from '../src/exports/obsidian/obsidian-renderer.ts';
import { dimensionBands } from '../src/domain/learner-state.ts';
const rich = Buffer.from('\r\n## Personal reflection\r\n\r\nα ⇒ β; 日本語 🧠\r\n[[My private link]]\r\n```yaml\r\nstage: durable_mastery\r\n---\r\n```\r\n<!-- personal comment -->\r\nI mastered this.\r\n'.repeat(40), 'utf8');
function conceptPath(f: Awaited<ReturnType<typeof obsidianFixture>>) { return join(f.exports.path(), loadManifest(f.exports.vault).manifest.notes[noteKey('concept', f.course.id, f.conceptId)]!.path); }
function assertLinks(root: string) { for (const file of noteFiles(root)) {
    const text = readFileSync(file, 'utf8').split(markers.us)[0]!;
    for (const match of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g))
        assert(existsSync(join(root, match[1] + '.md')), 'Broken wiki target in ' + file);
} }
for (const mode of ['source_grounded', 'generated_curriculum', 'hybrid'] as const)
    test('offline ' + mode + ' sync projects real services, exact provenance and wiki graph without canonical writes', async () => {
        const f = await obsidianFixture(mode);
        try {
            fillProfile(f);
            const before = dbRows(f.root);
            f.exports.init();
            f.exports.sync(f.course.id);
            const manifest = loadManifest(f.exports.vault).manifest, text = readFileSync(conceptPath(f), 'utf8');
            assert.match(readFileSync(join(f.exports.path(), 'Home.md'), 'utf8'), /SQLite is canonical/);
            assert.match(text, /provisional_competence/);
            assert.match(text, /structural_understanding/);
            assert.match(text, /Missing evidence/);
            assert.match(text, /\/teach start \{"conceptId"/);
            assert.match(text, /private self-study|No generated explanation/);
            assert.equal(Object.values(manifest.notes).filter(n => n.kind === 'concept').length, 1);
            if (mode !== 'generated_curriculum') {
                assert(text.includes(f.ingested!.source.id + '@1:0'));
                assert.match(text, /text offsets/);
            }
            if (mode !== 'source_grounded')
                assert.match(text, /reference-/);
            assertLinks(f.exports.path());
            assert.equal(dbRows(f.root), before);
            assert(!/\b\d+%\s*master/.test(text));
        }
        finally {
            f.close();
        }
    });
test('USER bytes, immutable SQLite and stable file identity survive state changes and edited mastery metadata', async () => {
    const f = await obsidianFixture();
    try {
        f.exports.sync(f.course.id);
        const path = conceptPath(f);
        setUser(path, rich);
        writeFileSync(path, readFileSync(path, 'utf8').replace('stage: null', 'stage: "durable_mastery"'));
        const untouched = dbRows(f.root);
        f.exports.sync(f.course.id);
        assert.equal(dbRows(f.root), untouched);
        assert.deepEqual(userBytes(path), rich);
        f.observe('memory_accessibility', 0);
        f.runtime.reviews.refresh(f.course.id);
        const before = dbRows(f.root);
        f.exports.sync(f.course.id);
        assert.deepEqual(userBytes(path), rich);
        assert.match(readFileSync(path, 'utf8'), /independent_difficulty/);
        assert.equal(dbRows(f.root), before);
    }
    finally {
        f.close();
    }
});
test('unchanged sync is byte-identical, preserves manifest and avoids file rewrites despite clock advance', async () => {
    const f = await obsidianFixture();
    try {
        fillProfile(f);
        f.exports.sync(f.course.id);
        const before = fileState(f.exports.path()), manifest = readFileSync(join(f.exports.path(), manifestPath));
        f.tick(1000);
        const second = f.exports.sync(f.course.id);
        assert.equal(second.written, 0);
        assert.deepEqual(fileState(f.exports.path()), before);
        assert.deepEqual(readFileSync(join(f.exports.path(), manifestPath)), manifest);
    }
    finally {
        f.close();
    }
});
test('missing, duplicate and malformed markers fail preflight without touching original notes or manifest', async () => {
    const f = await obsidianFixture();
    try {
        f.exports.sync(f.course.id);
        const path = conceptPath(f), original = readFileSync(path), manifest = readFileSync(join(f.exports.path(), manifestPath));
        for (const corrupt of [original.toString().replace(markers.us, ''), original.toString() + markers.gs, original.toString().replace(markers.gs, markers.us).replace(markers.ue, markers.ge), original.toString().replace('note_key:', 'wrong_key:')]) {
            writeFileSync(path, corrupt);
            assert.throws(() => f.exports.sync(f.course.id), /conflict/);
            assert.equal(readFileSync(path, 'utf8'), corrupt);
            assert.deepEqual(readFileSync(join(f.exports.path(), manifestPath)), manifest);
        }
        writeFileSync(path, original);
    }
    finally {
        f.close();
    }
});
test('readable names handle Unicode, reserved devices, invalid characters, long names, duplicate/case titles and unsafe paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'obsidian paths '));
    try {
        const vault = new SafeVault(root);
        for (const title of ['CON', 'nul.txt', 'LPT1', '..', 'C:\\outside\\bad', '<bad>:*?"|', '日本語 αβ', 'x'.repeat(1000), 'ends. ']) {
            const name = readableName(title, 'concept-12345678-1234-4123-8123-123456789012');
            assert(name.length < 100);
            assert(!/[<>:"/\\|?*]/.test(name));
            assert(vault.path('Courses/test/Concepts/' + name + '.md').startsWith(vault.root));
        }
        assert.notEqual(readableName('Same', 'concept-11111111-1111-4111-8111-111111111111').toLowerCase(), readableName('same', 'concept-22222222-2222-4222-8222-222222222222').toLowerCase());
        for (const path of ['../escape', 'C:/escape', '/absolute', 'a/../../escape', 'a\\..\\escape', 'a/CON.md', 'a/file.'])
            assert.throws(() => vault.path(path));
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test('vault, directory and leaf junction/reparse escapes are rejected without touching outside files', () => {
    const root = mkdtempSync(join(tmpdir(), 'obsidian junction '));
    try {
        mkdirSync(join(root, 'outside'));
        mkdirSync(join(root, '_learning'));
        symlinkSync(join(root, 'outside'), join(root, '_learning', 'obsidian-vault'), process.platform === 'win32' ? 'junction' : 'dir');
        assert.throws(() => new SafeVault(root), /symbolic|reparse/);
        assert.deepEqual(noteFiles(join(root, 'outside')), []);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
    const root2 = mkdtempSync(join(tmpdir(), 'obsidian nested junction '));
    try {
        const vault = new SafeVault(root2);
        vault.path('Courses/course/note.md', true);
        mkdirSync(join(root2, 'outside'));
        symlinkSync(join(root2, 'outside'), join(vault.root, 'Courses', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
        assert.throws(() => vault.write('Courses/escape/secret.md', Buffer.from('x'), null), /symbolic|reparse/);
        assert(!existsSync(join(root2, 'outside', 'secret.md')));
    }
    finally {
        rmSync(root2, { recursive: true, force: true });
    }
});
test('real prerequisite and cyclic non-prerequisite graph links resolve; renamed/reused and retired concepts preserve annotations', async () => {
    const f = await obsidianFixture();
    try {
        const r = f.runtime, refs = f.graph.nodes[0]!.sourceRefs.map(({ sourceId, version, segmentId }) => ({ sourceId, version, segmentId }));
        const graph = r.graphs.createDraft(f.course.id, { nodes: [{ key: 'a', conceptId: f.conceptId, title: 'CON', summary: 'SYNTHETIC A', type: 'definition', sourceRefs: refs, researchRefs: [] }, { key: 'b', title: 'Same', summary: 'SYNTHETIC B', type: 'definition', sourceRefs: refs, researchRefs: [] }, { key: 'c', title: 'same', summary: 'SYNTHETIC C', type: 'definition', sourceRefs: refs, researchRefs: [] }], edges: [{ from: 'a', to: 'b', type: 'prerequisite_of', rationale: 'SYNTHETIC prerequisite' }, { from: 'b', to: 'c', type: 'confusable_with', rationale: 'SYNTHETIC confusion' }, { from: 'c', to: 'a', type: 'related_to', rationale: 'SYNTHETIC cycle' }], rationale: 'SYNTHETIC graph', uncertainty: [] });
        r.graphs.activate(f.course.id, graph.version);
        f.exports.sync(f.course.id);
        const before = loadManifest(f.exports.vault).manifest, path = conceptPath(f), retired = graph.nodes.find(n => n.title === 'same')!;
        setUser(path, rich);
        const retiredPath = join(f.exports.path(), before.notes[noteKey('concept', f.course.id, retired.conceptId)]!.path);
        setUser(retiredPath, rich);
        assertLinks(f.exports.path());
        assert.match(readFileSync(path, 'utf8'), /Dependents/);
        const v3 = r.graphs.createDraft(f.course.id, { nodes: [{ key: 'a', conceptId: f.conceptId, title: 'Renamed α implication', summary: 'SYNTHETIC revised', type: 'definition', sourceRefs: refs, researchRefs: [] }, { key: 'new', title: 'New', summary: 'SYNTHETIC new', type: 'concept', sourceRefs: refs, researchRefs: [] }], edges: [], rationale: 'SYNTHETIC revision', uncertainty: [] });
        r.graphs.activate(f.course.id, v3.version);
        f.exports.sync(f.course.id);
        assert.equal(conceptPath(f), path);
        assert.deepEqual(userBytes(path), rich);
        assert.deepEqual(userBytes(retiredPath), rich);
        assert.match(readFileSync(path, 'utf8'), /Renamed α implication/);
        assert.match(readFileSync(retiredPath, 'utf8'), /Historical\/inactive/);
        assertLinks(f.exports.path());
    }
    finally {
        f.close();
    }
});
test('note write/rename and manifest failures preserve original USER bytes and do not claim successful sync; retry recovers', async () => {
    for (const failure of ['write', 'rename', 'manifest']) {
        const f = await obsidianFixture();
        try {
            f.exports.sync(f.course.id);
            const path = conceptPath(f);
            setUser(path, rich);
            const original = readFileSync(path), oldManifest = readFileSync(join(f.exports.path(), manifestPath));
            f.observe('memory_accessibility', 0);
            f.runtime.reviews.refresh(f.course.id);
            const broken = new ObsidianExportService(f.root, f.reader, f.clock, { write: (p, b) => { if (failure === 'write' && p.includes('Concepts'))
                    throw Error('SYNTHETIC write failure'); writeFileSync(p, b, { flag: 'wx' }); }, rename: (a, b) => { if (failure === 'rename' && b === path || failure === 'manifest' && b.endsWith('manifest.json'))
                    throw Error('SYNTHETIC rename failure'); renameSync(a, b); } });
            assert.throws(() => broken.sync(f.course.id), /SYNTHETIC/);
            if (failure !== 'manifest')
                assert.deepEqual(readFileSync(path), original);
            assert.deepEqual(userBytes(path), rich);
            assert.deepEqual(readFileSync(join(f.exports.path(), manifestPath)), oldManifest);
            f.exports.sync(f.course.id);
            assert.deepEqual(userBytes(path), rich);
        }
        finally {
            f.close();
        }
    }
});
test('manifest deletion conservatively recovers stable paths/user text; corrupt manifest and identity conflicts refuse overwrite', async () => {
    const f = await obsidianFixture();
    try {
        f.exports.sync(f.course.id);
        const path = conceptPath(f);
        setUser(path, rich);
        unlinkSync(join(f.exports.path(), manifestPath));
        f.exports.sync(f.course.id);
        assert.equal(conceptPath(f), path);
        assert.deepEqual(userBytes(path), rich);
        const bytes = readFileSync(path);
        writeFileSync(join(f.exports.path(), manifestPath), 'bad JSON');
        assert.throws(() => f.exports.sync(f.course.id), /manifest/);
        assert.deepEqual(readFileSync(path), bytes);
    }
    finally {
        f.close();
    }
});
test('diagnostic and teaching notes include bounded metadata/evidence, not responses; session reflections survive sync', async () => {
    const f = await obsidianFixture();
    try {
        const r = f.runtime, d = r.diagnostics.start(f.course.id, 1), p = (await r.diagnostics.next(f.course.id, f.diagnosticGenerator)).probe!;
        const { DeterministicEvaluator } = await import('../src/evaluation/deterministic.ts');
        await r.diagnostics.submit(f.course.id, p.id, { response: 'SYNTHETIC_PRIVATE_RESPONSE_SENTINEL', assistance: 'none', hints: { count: 0, highestLevel: 'none', notes: null } }, new DeterministicEvaluator());
        await r.diagnostics.next(f.course.id, f.diagnosticGenerator);
        await finishInstruction(f);
        f.exports.sync(f.course.id);
        const manifest = loadManifest(f.exports.vault).manifest;
        for (const entry of Object.values(manifest.notes).filter(n => ['diagnostic', 'teaching'].includes(n.kind))) {
            const path = join(f.exports.path(), entry.path), text = readFileSync(path, 'utf8');
            assert.match(text, /evidence-/);
            assert(!text.includes('SYNTHETIC_PRIVATE_RESPONSE_SENTINEL'));
            setUser(path, rich);
            f.exports.sync(f.course.id);
            assert.deepEqual(userBytes(path), rich);
        }
    }
    finally {
        f.close();
    }
});
test('renderer preserves all bands/stages/gap lifecycles and review timing without claiming that overdue means forgotten', async () => {
    const f = await obsidianFixture();
    try {
        fillProfile(f);
        const s = f.reader.read(f.course.id);
        for (const stage of ['not_ready', 'instructionally_ready', 'provisional_competence', 'durable_mastery'] as const)
            for (const band of dimensionBands) {
                const copy = structuredClone(s);
                copy.state!.readiness[0]!.stage = stage;
                copy.state!.dimensions[0]!.band = band;
                const m = loadManifest(f.exports.vault).manifest;
                const note = buildPlans(m, copy).find(p => p.entry.kind === 'concept')!;
                assert(note.body.includes(stage));
                assert(note.body.includes(band));
            }
        for (const status of ['OPEN', 'REPAIR_IN_PROGRESS', 'AWAITING_VERIFICATION', 'VERIFIED_CLOSED'] as const) {
            f.observe('memory_accessibility', 0);
            const r = f.runtime.reviews.refresh(f.course.id), copy = f.reader.read(f.course.id);
            copy.state!.gaps[0]!.status = status;
            copy.state!.gaps[0]!.recursFrom = copy.state!.gaps[0]!.id;
            const plans = buildPlans(loadManifest(f.exports.vault).manifest, copy), gap = plans.find(p => p.entry.kind === 'gap')!;
            assert(gap.body.includes(status));
            assert(gap.body.includes('Recurs from:'));
            assert(r.gaps.length);
        }
        const copy = structuredClone(s), item = copy.reviews[0]!;
        copy.reviews = [{ ...item, id: item.id + '-synthetic1', kind: 'gap_verification', dueAt: copy.at, earliestAt: copy.at }, { ...item, id: item.id + '-synthetic2', kind: 'delayed_verification', dueAt: copy.at, earliestAt: copy.at }, { ...item, id: item.id + '-synthetic3', kind: 'maintenance', dueAt: new Date(Date.parse(copy.at) - day).toISOString(), earliestAt: new Date(Date.parse(copy.at) - day).toISOString() }, item];
        const queue = buildPlans(loadManifest(f.exports.vault).manifest, copy).find(p => p.entry.kind === 'reviews')!.body;
        assert.match(queue, /overdue \(1\)/);
        assert.match(queue, /due \(2\)/);
        assert.match(queue, /upcoming \(1\)/);
        assert.match(queue, /does not mean forgotten/);
    }
    finally {
        f.close();
    }
});
test('enrichment cache survives unrelated learner changes, becomes stale on presentation change, and regenerates explicitly', async () => {
    const f = await obsidianFixture();
    try {
        let calls = 0;
        const generator = { propose: async (c: Parameters<typeof fakeStudy.propose>[0]) => { calls++; return fakeStudy.propose(c); } };
        f.exports.sync(f.course.id);
        setUser(conceptPath(f), rich);
        assert.equal((await f.exports.enrich(f.course.id, 'all', generator)).results[0]!.status, 'updated');
        f.exports.sync(f.course.id);
        assert.equal((await f.exports.enrich(f.course.id, 'all', generator)).results[0]!.status, 'current');
        assert.equal(calls, 1);
        f.observe('memory_accessibility', 0);
        f.runtime.reviews.refresh(f.course.id);
        f.exports.sync(f.course.id);
        assert.equal(f.exports.status(f.course.id).staleMaterials, 0);
        assert.equal(calls, 1);
        const v = f.runtime.graphs.createDraft(f.course.id, { nodes: [{ key: 'a', conceptId: f.conceptId, title: 'SYNTHETIC new presentation', summary: 'SYNTHETIC changed', type: 'definition', sourceRefs: f.graph.nodes[0]!.sourceRefs.map(({ sourceId, version, segmentId }) => ({ sourceId, version, segmentId })), researchRefs: [] }], edges: [], rationale: 'SYNTHETIC rebuild', uncertainty: [] });
        f.runtime.graphs.activate(f.course.id, v.version);
        f.exports.sync(f.course.id);
        assert.equal(f.exports.status(f.course.id).staleMaterials, 1);
        assert.match(readFileSync(conceptPath(f), 'utf8'), /material_status: "stale"/);
        await f.exports.enrich(f.course.id, 'all', generator);
        assert.equal(calls, 2);
        assert.equal(f.exports.status(f.course.id).staleMaterials, 0);
        assert.deepEqual(userBytes(conceptPath(f)), rich);
    }
    finally {
        f.close();
    }
});
test('enrichment failure preserves deterministic notes/prior material and rejects results stale after curriculum change', async () => {
    const f = await obsidianFixture();
    try {
        await f.exports.enrich(f.course.id, 'all', fakeStudy);
        const path = conceptPath(f);
        setUser(path, rich);
        const before = readFileSync(path);
        const result = await f.exports.enrich(f.course.id, f.conceptId, { propose: async () => { throw Error('SYNTHETIC provider unavailable'); } });
        assert.equal(result.results[0]!.status, 'failed');
        assert.deepEqual(readFileSync(path), before);
        f.exports.sync(f.course.id);
        assert.deepEqual(readFileSync(path), before);
        const result2 = await f.exports.enrich(f.course.id, f.conceptId, { propose: async (c) => { const v = f.runtime.graphs.createDraft(f.course.id, { nodes: [{ key: 'a', conceptId: f.conceptId, title: 'SYNTHETIC new', type: 'definition', summary: 'SYNTHETIC new', sourceRefs: f.graph.nodes[0]!.sourceRefs.map(({ sourceId, version, segmentId }) => ({ sourceId, version, segmentId })), researchRefs: [] }], edges: [], rationale: 'SYNTHETIC race', uncertainty: [] }); f.runtime.graphs.activate(f.course.id, v.version); return fakeStudy.propose(c); } });
        assert.equal(result2.results[0]!.status, 'failed');
        assert.deepEqual(userBytes(path), rich);
    }
    finally {
        f.close();
    }
});
test('course title changes keep folders stable; new independent personal notes survive manifest recovery', async () => {
    const f = await obsidianFixture();
    try {
        f.exports.sync(f.course.id);
        const old = loadManifest(f.exports.vault).manifest.courses[f.course.id]!.path;
        const renamed = new ObsidianExportService(f.root, { read: id => { const s = f.reader.read(id); return { ...s, course: { ...s.course, title: 'SYNTHETIC renamed course α' } }; }, ground: f.reader.ground.bind(f.reader) }, f.clock);
        renamed.sync(f.course.id);
        assert.equal(loadManifest(renamed.vault).manifest.courses[f.course.id]!.path, old);
        assert.match(readFileSync(join(renamed.path(), old, 'Dashboard.md'), 'utf8'), /renamed course α/);
        const personal = join(renamed.path(), 'Personal.md');
        writeFileSync(personal, 'SYNTHETIC independent personal note — unchanged');
        unlinkSync(join(renamed.path(), manifestPath));
        renamed.sync(f.course.id);
        assert.equal(readFileSync(personal, 'utf8'), 'SYNTHETIC independent personal note — unchanged');
        assert.equal(loadManifest(renamed.vault).manifest.courses[f.course.id]!.path, old);
    }
    finally {
        f.close();
    }
});
test('status counts actual notes and reports marker conflicts without writes', async () => {
    const f = await obsidianFixture();
    try {
        const initial = f.exports.status(f.course.id);
        assert.equal(initial.conceptNotes, 0);
        assert.equal(initial.activeConcepts, 1);
        assert.equal(initial.initialized, false);
        f.exports.sync(f.course.id);
        const path = conceptPath(f);
        writeFileSync(path, readFileSync(path, 'utf8').replace(markers.ge, ''));
        const b = readFileSync(path);
        const result = f.exports.status(f.course.id);
        assert.equal(result.conflicts.length, 1);
        assert.deepEqual(readFileSync(path), b);
    }
    finally {
        f.close();
    }
});
