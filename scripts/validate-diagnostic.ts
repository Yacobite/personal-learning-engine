import assert from 'node:assert/strict';
import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openLearningDatabase } from '../src/persistence/database.ts';
import { CourseService } from '../src/services/course-service.ts';
import { GraphService } from '../src/services/graph-service.ts';
import { AssessmentService } from '../src/services/assessment-service.ts';
import { EvaluationService } from '../src/services/evaluation-service.ts';
import { DiagnosticService } from '../src/services/diagnostic-service.ts';
import { DiagnosticContextBuilder } from '../src/services/diagnostic-context.ts';
import { topology } from '../src/domain/diagnostic-policy.ts';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import type { DiagnosticTaskGenerator } from '../src/ports/diagnostic-generator.ts';
const [workspace, ...courseIds] = process.argv.slice(2);
if (!workspace || !courseIds.length)
    throw Error('Usage: node scripts/validate-diagnostic.ts <M3-workspace> <Logic-course-id> [Python-course-id]');
const original = resolve(workspace, '_learning', 'learning.db');
const digest = () => createHash('sha256').update(readFileSync(original)).digest('hex');
const before = digest();
const directory = resolve('_learning', 'm5-acceptance');
mkdirSync(directory, { recursive: true });
const run = mkdtempSync(join(directory, 'run-'));
const reports: unknown[] = [];
const paths = new Map<string, Set<string>>();
for (const courseId of courseIds)
    for (const profile of ['beginner', 'intermediate', 'advanced'] as const) {
        const isolated = join(run, `${courseId}-${profile}`);
        mkdirSync(join(isolated, '_learning'), { recursive: true });
        const reader = new DatabaseSync(original, { readOnly: true });
        try {
            await backup(reader, join(isolated, '_learning', 'learning.db'));
        }
        finally {
            reader.close();
        }
        const store = openLearningDatabase(isolated);
        try {
            const id = (prefix: string) => `${prefix}-${randomUUID()}`;
            const hash = (v: string) => createHash('sha256').update(v).digest('hex');
            const clock = () => new Date();
            const courses = new CourseService(store.courses, () => id('course'), clock);
            const graphs = new GraphService(courses, store.graphs, store.sources, store.research, () => id('concept'), clock);
            const assessments = new AssessmentService(courses, store.assessments, store.graphs, store.sources, store.research, id, hash, clock);
            const evaluations = new EvaluationService(assessments, store.assessments, id, hash, clock);
            const diagnostics = new DiagnosticService(store.diagnostics, store.assessments, graphs, assessments, evaluations, new DiagnosticContextBuilder(store.sources, store.research), id, clock);
            const graph = graphs.get(courseId);
            const t = topology(graph);
            const maxDepth = Math.max(...t.depth.values());
            const threshold = profile === 'beginner' ? 0 : profile === 'intermediate' ? Math.floor(maxDepth / 2) : maxDepth;
            const generator: DiagnosticTaskGenerator = { propose: async (c) => ({ prompt: `SYNTHETIC DEVELOPMENT ACCEPTANCE ONLY: scripted fixture for ${c.conceptId}. This is an orchestration test, not a knowledge assessment.`, scoring: { kind: 'text', expected: 'alpha', normalization: 'exact' }, sourceRefs: c.source.map(s => s.ref), researchRefs: c.research.map(r => r.ref) }) };
            const session = diagnostics.start(courseId, 12);
            const responses: unknown[] = [];
            const probedIds: string[] = [];
            for (let i = 0; i <= session.budget; i++) {
                const next = await diagnostics.next(courseId, generator);
                if (!next.probe)
                    break;
                const p = next.probe;
                const task = assessments.task(courseId, p.taskId);
                const response = t.depth.get(p.conceptId)! <= threshold ? 'alpha' : 'beta';
                const resolved = await diagnostics.submit(courseId, p.id, { response, assistance: 'none', hints: { count: 0, highestLevel: 'none', notes: 'SYNTHETIC development acceptance data; not learner performance.' } }, new DeterministicEvaluator());
                assert.equal(resolved.status, 'resolved');
                responses.push({ conceptId: p.conceptId, depth: t.depth.get(p.conceptId), selectionReason: p.selectionReason, type: task.type, representation: task.representation, response, attemptId: resolved.attemptId, outcomes: resolved.outcomes });
                probedIds.push(p.conceptId);
            }
            const completed = diagnostics.get(courseId, session.id);
            assert.equal(completed.status, 'completed');
            assert.ok(completed.summary);
            assert.equal(diagnostics.current(courseId), undefined);
            const report = { label: 'SYNTHETIC DEVELOPMENT ACCEPTANCE — orchestration only; no pedagogical optimality claim.', courseId, curriculumVersion: graph.version, policy: session.policy, profile, budget: session.budget, maximumGraphDepth: maxDepth, syntheticSupportDepth: threshold,
                conceptCount: graph.nodes.length, prerequisiteEdges: graph.edges.filter(e => e.type === 'prerequisite_of').length, branchConcepts: t.ids.filter(id => t.children.get(id)!.length > 1), mergeConcepts: t.ids.filter(id => t.parents.get(id)!.length > 1),
                branchVisits: t.ids.filter(id => t.children.get(id)!.length > 1).map(conceptId => ({conceptId, children: t.children.get(conceptId), probedChildren: t.children.get(conceptId)!.filter(id => probedIds.includes(id))})),
                mergeVisits: t.ids.filter(id => t.parents.get(id)!.length > 1 && probedIds.includes(id)).map(conceptId => ({conceptId, prerequisites: t.parents.get(conceptId), directlyProbedPrerequisites: t.parents.get(conceptId)!.filter(id => probedIds.includes(id))})),
                probes: responses, summary: completed.summary, probesSavedAgainstFullTraversal: graph.nodes.length - responses.length };
            reports.push(report);
            if (!paths.has(courseId)) paths.set(courseId, new Set());
            paths.get(courseId)!.add(JSON.stringify(probedIds));
            console.log(JSON.stringify({ courseId, profile, version: graph.version, concepts: graph.nodes.length, probes: responses.length, stopReason: completed.stopReason, frontier: completed.summary.frontier, probesSaved: graph.nodes.length - responses.length }));
        }
        finally {
            store.close();
        }
    }
assert.equal(digest(), before, 'Original M3 database must remain unchanged');
for (const [courseId, uniquePaths] of paths) assert.equal(uniquePaths.size, 3, `Synthetic profiles must produce distinct paths for ${courseId}`);
writeFileSync(join(run, 'report.json'), JSON.stringify({ originalDatabaseUnchanged: true, reports }, null, 2));
console.log(`Private synthetic reports: ${join(run, 'report.json')}`);
