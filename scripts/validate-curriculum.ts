/** Explicit local acceptance: learner sources, proposals and reports stay ignored. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { openLearningDatabase } from '../src/persistence/database.ts';
import { CourseService } from '../src/services/course-service.ts';
import { SourceService } from '../src/services/source-service.ts';
import { GraphService } from '../src/services/graph-service.ts';
import { ResearchService } from '../src/services/research-service.ts';
import { ProjectSourceReader } from '../src/ingestion/input-reader.ts';
import { PdfParser } from '../src/ingestion/pdf-parser.ts';
import { PythonDocsResearcher } from '../src/research/official-docs.ts';
import { compactMap } from '../src/runtime/pi/register-curriculum.ts';
import { createBuilderTools } from '../src/runtime/pi/curriculum-tools.ts';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { CurriculumProposal } from '../src/domain/curriculum.ts';
const project = resolve(process.cwd());
const base = join(project, '_learning', 'm3-acceptance');
mkdirSync(base, { recursive: true });
const [phase = 'prepare', argument] = process.argv.slice(2);
const workspace = phase === 'prepare' ? mkdtempSync(join(base, 'run-')) : realpathSync(resolve(argument ?? ''));
const within = relative(realpathSync(base), workspace);
assert.ok(within && !isAbsolute(within) && within !== '..' && !within.startsWith('..\\') && !within.startsWith('../'), 'Acceptance workspace must stay beneath _learning/m3-acceptance.');
let store = openLearningDatabase(workspace);
const courses = () => new CourseService(store.courses, () => `course-${randomUUID()}`, () => new Date());
const graphs = () => new GraphService(courses(), store.graphs, store.sources, store.research, () => `concept-${randomUUID()}`, () => new Date());
const sources = () => new SourceService(courses(), store.sources, new ProjectSourceReader(workspace), [new PdfParser()], (bytes) => createHash('sha256').update(bytes).digest('hex'), () => `source-${randomUUID()}`);
try {
    if (phase === 'prepare') {
        const logic = courses().createCourse({ title: 'Logic M3 acceptance', mode: 'source_grounded', objective: 'Learn the actual Logic Topic 0–2 material' });
        mkdirSync(join(workspace, 'sources', 'inbox'), { recursive: true });
        const originals = [];
        for (const name of ['topic0.pdf', 'topic1.pdf', 'topic2.pdf']) {
            const path = join(project, 'sources', 'inbox', name);
            const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
            originals.push({ name, hash });
            copyFileSync(path, join(workspace, 'sources', 'inbox', name));
            await sources().ingest(logic.id, { location: `sources/inbox/${name}` });
        }
        const python = courses().createCourse({ title: 'Python M3 acceptance', mode: 'generated_curriculum', objective: 'Python from zero to writing small independent programs.' });
        const brief = await new ResearchService(courses(), store.research, new PythonDocsResearcher()).retrieve(python.id);
        const manifest = { workspace, logicCourseId: logic.id, pythonCourseId: python.id, originals,
            documents: store.sources.list(logic.id).map((source) => ({ source, document: store.sources.getVersion(logic.id, source.id, source.currentVersion) })), brief };
        writeFileSync(join(workspace, 'manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(JSON.stringify({ workspace, logicCourseId: logic.id, pythonCourseId: python.id, research: brief.references.map(({ text: _text, ...ref }) => ref) }, null, 2));
    }
    else if (phase === 'complete') {
        const manifest = JSON.parse(readFileSync(join(workspace, 'manifest.json'), 'utf8')) as {
            logicCourseId: string;
            pythonCourseId: string;
            brief: {
                id: string;
            };
            originals: {
                name: string;
                hash: string;
            }[];
        };
        const reports = [];
        for (const [kind, courseId] of [['logic', manifest.logicCourseId], ['python', manifest.pythonCourseId]] as const) {
            const input = JSON.parse(readFileSync(join(workspace, `${kind}-proposal.json`), 'utf8')) as CurriculumProposal;
            const brief = kind === 'python' ? store.research.get(courseId, manifest.brief.id) : undefined;
            const builder = createBuilderTools(courseId, sources(), graphs(), brief);
            await builder.tools[1]!.execute('acceptance', { proposal: input }, undefined, undefined, {} as Parameters<ToolDefinition['execute']>[4]);
            const first = builder.getDraft()!;
            assert.equal(graphs().current(courseId), undefined);
            graphs().validate(courseId, first.version);
            graphs().activate(courseId, first.version);
            const firstSaved = graphs().get(courseId, first.version);
            store.close();
            store = openLearningDatabase(workspace);
            assert.deepEqual(graphs().get(courseId), firstSaved);
            const second = graphs().createDraft(courseId, { ...input, nodes: input.nodes.map((node) => ({ ...node,
                    conceptId: first.nodes.find((saved) => saved.title === node.title)!.conceptId, title: `${node.title} (revised presentation)` })) });
            assert.equal(graphs().current(courseId), first.version);
            assert.deepEqual(graphs().get(courseId, first.version), firstSaved);
            assert.deepEqual([...first.nodes.map((node) => node.conceptId)].sort(), [...second.nodes.map((node) => node.conceptId)].sort());
            graphs().activate(courseId, second.version);
            store.close();
            store = openLearningDatabase(workspace);
            assert.equal(graphs().current(courseId), second.version);
            reports.push({ kind, courseId, firstVersion: first.version, newerVersion: second.version, conceptCount: first.nodes.length,
                edgeCounts: Object.fromEntries([...new Set(first.edges.map((edge) => edge.type))].map((type) => [type, first.edges.filter((edge) => edge.type === type).length])),
                prerequisiteOrder: graphs().validate(courseId, first.version), nodes: first.nodes, edges: first.edges, uncertainty: first.uncertainty, map: compactMap(first),
                provenanceValid: true, restartPersistence: true, stableConcepts: true, historyPreserved: true,
                proposalMethod: 'Reviewed proposal authored from retrieved evidence and submitted through the model-facing proposal tool; no live Pi provider call.' });
        }
        for (const original of manifest.originals)
            assert.equal(createHash('sha256').update(readFileSync(join(project, 'sources', 'inbox', original.name))).digest('hex'), original.hash);
        writeFileSync(join(workspace, 'report.json'), JSON.stringify(reports, null, 2));
        console.log(JSON.stringify({ workspace, reports: reports.map(({ nodes: _nodes, edges: _edges, ...report }) => report) }, null, 2));
    }
    else
        throw new Error('Use prepare or complete <ignored-workspace>.');
}
finally {
    store.close();
}
