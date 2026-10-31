import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { systemRuntime } from '../tests/helpers/system-fixtures.ts';
import { CanonicalObsidianReader } from '../src/services/obsidian-projection-reader.ts';
import { ObsidianExportService } from '../src/exports/obsidian/obsidian-export-service.ts';
import { loadManifest, noteKey, manifestPath } from '../src/exports/obsidian/obsidian-manifest.ts';
import { markers } from '../src/exports/obsidian/obsidian-notes.ts';
import { noteFiles, setUser, userBytes } from '../tests/helpers/obsidian-fixtures.ts';
const [workspace, courseId, mode] = process.argv.slice(2);
if (!workspace || !courseId || !['logic', 'python'].includes(mode ?? ''))
    throw Error('Usage: node scripts/validate-obsidian.ts <historical-workspace> <course-id> <logic|python>');
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex'), original = resolve(workspace, '_learning/learning.db'), originalHash = hash(original);
const parent = resolve('_learning/obsidian-acceptance');
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'run-'));
mkdirSync(join(root, '_learning'));
const input = new DatabaseSync(original, { readOnly: true });
try {
    await backup(input, join(root, '_learning/learning.db'));
}
finally {
    input.close();
}
const clock = () => new Date('2051-01-01T00:00:00.000Z'), r = systemRuntime(root, clock), reader = new CanonicalObsidianReader(r.store, r.grounding, fn => r.store.readSnapshot(fn), clock), exports = new ObsidianExportService(root, reader, clock);
try {
    const copy = join(root, '_learning/learning.db'), before = hash(copy), snapshot = reader.read(courseId);
    exports.init();
    exports.sync(courseId);
    let m = loadManifest(exports.vault).manifest;
    assert.equal(Object.values(m.notes).filter(n => n.courseId === courseId && n.kind === 'concept').length, snapshot.graph.nodes.length);
    assert(existsSync(join(exports.path(), 'Home.md')));
    assert(existsSync(join(exports.path(), m.notes[noteKey('course', courseId, courseId)]!.path)));
    const candidates = [snapshot.graph.nodes.find(n => !snapshot.graph.edges.some(e => e.type === 'prerequisite_of' && e.to === n.conceptId)), snapshot.graph.nodes.find(n => /implica/i.test(n.title)), snapshot.graph.nodes.find(n => /entail|deduc/i.test(n.title)), ...snapshot.graph.nodes], samples = [...new Set(candidates.filter(n => n !== undefined).map(n => n.conceptId))].slice(0, 3);
    const annotations = new Map<string, Buffer>();
    for (const id of samples) {
        const path = join(exports.path(), m.notes[noteKey('concept', courseId, id)]!.path), bytes = Buffer.from('\r\nSYNTHETIC private acceptance reflection — α → β\r\n[[Personal question]]\r\n```text\r\nmy notes remain presentation only\r\n```\r\n');
        setUser(path, bytes);
        annotations.set(id, bytes);
    }
    let calls = 0;
    const enriched = await exports.enrich(courseId, 'all', { propose: async (context) => { calls++; return { coreIdea: 'SYNTHETIC provider boundary fixture, not expert-validated teaching. Grounding excerpt for this private acceptance: ' + (context.source[0]?.text ?? context.research[0]?.text ?? '').slice(0, 500), keyPoints: ['Inspect the exact provenance below; no learner ability is inferred.'], selfCheckPrompts: ['What questions would you bring to tracked Pi teaching?'], sourceRefs: context.source.map(s => s.ref), researchRefs: context.research.map(r => r.ref) }; } });
    assert(enriched.results.every(x => x.status === 'updated'));
    exports.sync(courseId);
    m = loadManifest(exports.vault).manifest;
    let links = 0;
    for (const file of noteFiles(exports.path())) {
        const generated = readFileSync(file, 'utf8').split(markers.us)[0]!;
        for (const match of generated.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
            assert(existsSync(join(exports.path(), match[1] + '.md')));
            links++;
        }
    }
    for (const [id, bytes] of annotations) {
        const path = join(exports.path(), m.notes[noteKey('concept', courseId, id)]!.path);
        assert.deepEqual(userBytes(path), bytes);
        const text = readFileSync(path, 'utf8');
        assert(text.includes('SYNTHETIC provider boundary fixture'));
        assert(text.includes(mode === 'logic' ? 'physical page' : 'Authoritative / secondary research'));
    }
    const manifestBefore = readFileSync(join(exports.path(), manifestPath));
    assert.equal(exports.sync(courseId).written, 0);
    assert.deepEqual(readFileSync(join(exports.path(), manifestPath)), manifestBefore);
    assert.equal(hash(copy), before);
    assert.equal(hash(original), originalHash);
    assert.equal(r.store.health.diagnose(courseId).foreignKeyViolations, 0);
    const report = { mode, label: 'ALL PERFORMANCE COMES FROM PREVIOUS SYNTHETIC DEVELOPMENT ACCEPTANCE. Enrichment uses an explicit fake provider, not live generation or validated subject teaching.', result: 'passed', conceptNotes: snapshot.graph.nodes.length, wikiLinks: links, sampleNotes: samples.length, materialCalls: calls, sourceReferences: snapshot.graph.nodes.reduce((n, c) => n + c.sourceRefs.length, 0), researchReferences: snapshot.graph.nodes.reduce((n, c) => n + c.researchRefs.length, 0), stateStored: !!snapshot.state, gaps: snapshot.state?.gaps.length ?? 0, reviews: snapshot.reviews.length, diagnosticNotes: snapshot.diagnostics.length, teachingNotes: snapshot.teaching.length, userAnnotationsPreserved: true, idempotent: true, copyDatabaseUnchanged: true, originalDatabaseUnchanged: true, liveProviderQualityVerified: false, obsidianUIOpened: false, vault: exports.path() };
    writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report));
}
finally {
    r.store.close();
}
