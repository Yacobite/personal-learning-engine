import assert from 'node:assert/strict';
import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openLearningDatabase } from '../src/persistence/database.ts';
import { CourseService } from '../src/services/course-service.ts';
import { GraphService } from '../src/services/graph-service.ts';
import { AssessmentService } from '../src/services/assessment-service.ts';
import { EvaluationService } from '../src/services/evaluation-service.ts';
import { LearnerStateService } from '../src/services/learner-state-service.ts';
import { ReviewService } from '../src/services/review-service.ts';
import { TeachingContextBuilder } from '../src/services/teaching-context.ts';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import { reviewPolicies } from '../src/domain/review.ts';
import type { ReviewTaskContext } from '../src/ports/review-generator.ts';
import type { ReviewItem } from '../src/domain/review.ts';
import type { ScoringSpec } from '../src/domain/assessment.ts';
import type { Dimension } from '../src/domain/learner-state.ts';
/** Explicit local acceptance only. Reviewed private question content is never a portable fixture. */
interface Catalog {
    mode: 'logic' | 'python';
    courseId: string;
    conceptId: string;
    provisionalWorkspace: string;
    durableWorkspace: string;
    tasks: {
        dimension: Dimension;
        prompt: string;
        scoring: ScoringSpec;
        response: string;
        incorrect: string;
    }[];
}
const [path] = process.argv.slice(2);
if (!path)
    throw Error('Usage: node scripts/validate-review.ts <ignored-private-reviewed-catalog.json>');
const catalog = JSON.parse(readFileSync(path, 'utf8')) as Catalog;
assert(['logic', 'python'].includes(catalog.mode));
const day = 86400000, hash = (s: string) => createHash('sha256').update(s).digest('hex'), ids = (prefix: string) => prefix + '-' + randomUUID();
const dir = resolve('_learning/m8-acceptance');
mkdirSync(dir, { recursive: true });
const run = mkdtempSync(join(dir, 'run-'));
const reports: unknown[] = [];
for (const profile of catalog.mode === 'logic' ? ['A', 'B', 'C', 'D', 'E', 'F'] : ['A', 'B']) {
    const original = resolve(profile === 'A' || profile === 'D' ? catalog.provisionalWorkspace : catalog.durableWorkspace, '_learning/learning.db');
    const digest = () => hash(readFileSync(original).toString('base64')), before = digest();
    const reader = new DatabaseSync(original, { readOnly: true }), root = join(run, profile);
    mkdirSync(join(root, '_learning'), { recursive: true });
    const baseline = reader.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    assert.equal(baseline.length, 8);
    const oldTables = ['assessment_tasks', 'task_concepts', 'assessment_attempts', 'assessment_evaluations', 'evidence_events', 'diagnostic_sessions', 'diagnostic_probes', 'teaching_sessions', 'teaching_moves', 'learner_revisions', 'learner_gap_snapshots'];
    const originalRows = new Map(oldTables.map(t => [t, reader.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all()]));
    try {
        await backup(reader, join(root, '_learning/learning.db'));
    }
    finally {
        reader.close();
    }
    const store = openLearningDatabase(root);
    try {
        const initial = store.learnerLedger.read(catalog.courseId, '2099-01-01T00:00:00.000Z');
        let time = Math.max(...initial.map(r => Date.parse(r.attempt.submittedAt)), ...initial.flatMap(r => r.evaluations.map(e => Date.parse(e.createdAt)))) + 1, sequence = 0;
        const clock = () => new Date(time), courses = new CourseService(store.courses, () => ids('course'), clock);
        const graphs = new GraphService(courses, store.graphs, store.sources, store.research, () => ids('concept'), clock);
        const assessments = new AssessmentService(courses, store.assessments, store.graphs, store.sources, store.research, ids, hash, clock);
        const evaluations = new EvaluationService(assessments, store.assessments, ids, hash, clock);
        const state = new LearnerStateService(store.learnerState, store.learnerLedger, graphs, ids, hash, clock);
        const reviews = new ReviewService(store.reviews, store.assessments, graphs, assessments, evaluations, state, new TeachingContextBuilder(store.sources, store.research), () => ids('review'), hash, clock);
        const graph = graphs.get(catalog.courseId), target = graph.nodes.find(n => n.conceptId === catalog.conceptId);
        assert(target);
        const steps: unknown[] = [];
        const snapshot = (label: string) => {
            const revision = reviews.refresh(catalog.courseId);
            const report = revision.readiness.find(r => r.conceptId === catalog.conceptId)!;
            steps.push({ label, at: clock().toISOString(), revisionId: revision.id, state: report, gaps: revision.gaps.filter(g => g.conceptId === catalog.conceptId), queue: reviews.queue(catalog.courseId) });
            return report;
        };
        const selected = new Map<string, Catalog['tasks'][number]>();
        const used = new Set<string>();
        const generator = { propose: async (c: ReviewTaskContext) => {
                const entry = catalog.tasks.find(t => t.dimension === c.item.dimension && !used.has(t.prompt));
                if (!entry)
                    throw Error('Reviewed catalog lacks a fresh task for ' + c.item.dimension);
                used.add(entry.prompt);
                selected.set(c.grounding.conceptId, entry);
                return { prompt: entry.prompt, scoring: entry.scoring, sourceRefs: c.grounding.source.map(s => s.ref), researchRefs: c.grounding.research.map(r => r.ref) };
            } };
        const pending = () => store.reviews.list(catalog.courseId).filter(i => i.conceptId === catalog.conceptId && i.status === 'scheduled').sort((a, b) => (a.kind === 'gap_verification' ? 0 : 1) - (b.kind === 'gap_verification' ? 0 : 1))[0]!;
        const execute = async (item: ReviewItem, mode: 'success' | 'failure' | 'assisted' = 'success') => {
            time = Date.parse(item.dueAt);
            const before = state.refresh(catalog.courseId).readiness.find(r => r.conceptId === catalog.conceptId)!;
            const n = await reviews.next(catalog.courseId, generator);
            assert(n.item);
            assert.equal(n.item.id, item.id);
            const entry = selected.get(catalog.conceptId)!;
            const result = await reviews.answer(catalog.courseId, item.id, { response: mode === 'failure' ? entry.incorrect : entry.response, ...(mode === 'assisted' ? { assistance: 'guided' } : {}) }, new DeterministicEvaluator());
            steps.push({ label: 'performed_' + mode, before, ...result, after: state.refresh(catalog.courseId).readiness.find(r => r.conceptId === catalog.conceptId), next: pending() ?? null });
            return result;
        };
        const synthetic = (dimension: Dimension, correctness: 0 | 1) => {
            time += 1000;
            sequence++;
            const task = assessments.createTask(catalog.courseId, { conceptIds: [catalog.conceptId], type: 'cued_recall', intendedDimensions: [dimension], representation: 'text', novelty: dimension === 'transfer' ? 'near_transfer' : 'isomorphic', origin: 'manual',
                prompt: 'SYNTHETIC DEVELOPMENT M8 gap-transition fixture ' + profile + ' ' + sequence + '. Not a real learner claim.', scoring: { kind: 'open', rubricVersion: 'synthetic-m8-v1', criteria: [], expected: null }, sourceRefs: [], researchRefs: [] });
            const attempt = assessments.submit(catalog.courseId, 'synthetic-m8:' + profile + ':' + sequence, { taskId: task.id, response: 'ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA.', assistance: 'none', hints: { count: 0, highestLevel: 'none', notes: null } });
            evaluations.record(catalog.courseId, attempt.id, 'synthetic-m8-eval:' + profile + ':' + sequence, { kind: 'human', name: 'synthetic-development', version: '1', policyVersion: 'synthetic-m8-v1' }, { status: 'scored', correctness, rubricScores: {}, rationale: 'Synthetic development state-transition fixture.' });
        };
        snapshot('baseline');
        if (profile === 'A') {
            const i = pending();
            assert.equal(i.kind, 'delayed_verification');
            time = Date.parse(i.earliestAt) - 1;
            assert.equal((await reviews.next(catalog.courseId, generator)).item, null);
            snapshot('before_due');
            await execute(i);
            assert.equal(snapshot('after_delayed').stage, 'durable_mastery');
        }
        else if (profile === 'B') {
            for (const [stage, days] of [3, 7, 14, 30, 60, 60].entries()) {
                const i = pending();
                assert.equal(i.kind, 'maintenance');
                assert.equal(i.stage, Math.min(stage, 4));
                const at = stage === 0 ? Math.max(...initial.filter(r => r.task.conceptIds.includes(catalog.conceptId)).map(r => Date.parse(r.attempt.submittedAt))) : time;
                assert.equal(Date.parse(i.dueAt) - at, day * days);
                await execute(i);
            }
        }
        else if (profile === 'C') {
            await execute(pending(), 'failure');
            assert.notEqual(snapshot('after_failure').stage, 'durable_mastery');
            assert(!pending());
        }
        else if (profile === 'D') {
            const dimension = 'memory_accessibility';
            synthetic(dimension, 0);
            snapshot('gap_open');
            assert(!store.reviews.list(catalog.courseId).some(i => i.status === 'scheduled' && i.kind === 'gap_verification'));
            synthetic(dimension, 1);
            snapshot('gap_awaiting');
            const i = pending();
            assert.equal(i.kind, 'gap_verification');
            await execute(i);
            assert(state.refresh(catalog.courseId).gaps.filter(g => g.conceptId === catalog.conceptId).every(g => g.status === 'VERIFIED_CLOSED'));
        }
        else if (profile === 'E') {
            const i = pending();
            await execute(i, 'assisted');
            const next = pending();
            assert.equal(next.stage, i.stage);
            assert.equal(Date.parse(next.dueAt) - time, day);
        }
        else {
            const i = pending(), beforeState = state.refresh(catalog.courseId);
            time = Date.parse(i.dueAt) + 365 * day;
            assert.equal(reviews.queue(catalog.courseId).due[0]!.temporalStatus, 'overdue');
            assert.equal(state.refresh(catalog.courseId).id, beforeState.id);
            snapshot('overdue_without_performance');
        }
        const verifier = new DatabaseSync(join(root, '_learning/learning.db'), { readOnly: true });
        try {
            assert.deepEqual(verifier.prepare('SELECT * FROM schema_migrations WHERE version<=8 ORDER BY version').all(), baseline);
            for (const [table, rows] of originalRows) {
                const after = verifier.prepare('SELECT * FROM ' + table + ' ORDER BY rowid LIMIT ?').all(rows.length);
                assert.deepEqual(after, rows);
            }
            assert.deepEqual(verifier.prepare('PRAGMA foreign_key_check').all(), []);
        }
        finally {
            verifier.close();
        }
        reports.push({ label: 'ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA.', profile, courseId: catalog.courseId, curriculumVersion: graph.version, concept: { id: target.conceptId, title: target.title }, policies: reviewPolicies, baselineAuditUnchanged: true, steps });
        console.log(JSON.stringify({ profile, courseId: catalog.courseId, steps: steps.length, result: 'passed' }));
    }
    finally {
        store.close();
    }
    assert.equal(digest(), before);
}
writeFileSync(join(run, 'report.json'), JSON.stringify({ label: 'ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA.', originalDatabasesUnchanged: true, reports }, null, 2), 'utf8');
console.log('Private acceptance report: ' + join(run, 'report.json'));
