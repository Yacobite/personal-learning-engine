import assert from 'node:assert/strict';
import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openLearningDatabase } from '../src/persistence/database.ts';
import { CourseService } from '../src/services/course-service.ts';
import { AssessmentService } from '../src/services/assessment-service.ts';
import { EvaluationService } from '../src/services/evaluation-service.ts';
import { EvidenceService } from '../src/services/evidence-service.ts';
import { DeterministicEvaluator } from '../src/evaluation/deterministic.ts';
import type { TaskInput, Submission } from '../src/domain/assessment.ts';
// Explicit local structural acceptance, never production learner evidence.
// Supply an existing M3 workspace and its course ID; all writes go to a new ignored copy.
const [inputWorkspace, courseId] = process.argv.slice(2);
if (!inputWorkspace || !courseId)
    throw new Error('Usage: node scripts/validate-assessment.ts <M3-workspace> <course-id>');
const original = resolve(inputWorkspace, '_learning', 'learning.db');
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const before = digest(original);
const root = resolve('_learning', 'm4-acceptance');
mkdirSync(root, { recursive: true });
const run = mkdtempSync(join(root, 'run-'));
mkdirSync(join(run, '_learning'));
const source = new DatabaseSync(original, { readOnly: true });
try {
    await backup(source, join(run, '_learning', 'learning.db'));
}
finally {
    source.close();
}
const id = (prefix: string) => `${prefix}-${randomUUID()}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let store = openLearningDatabase(run);
try {
    const courses = new CourseService(store.courses, () => id('course'), () => new Date());
    courses.getCourse(courseId);
    const assessments = new AssessmentService(courses, store.assessments, store.graphs, store.sources, store.research, id, hash, () => new Date());
    const evaluations = new EvaluationService(assessments, store.assessments, id, hash, () => new Date());
    const evidence = new EvidenceService(courses, store.assessments, store.graphs);
    const v1 = store.graphs.get(courseId, 1);
    const v2 = store.graphs.get(courseId, 2);
    assert.ok(v1 && v2);
    const concept = v1.nodes.find((n) => n.sourceRefs.length);
    assert.ok(concept);
    store.graphs.activate(courseId, 1, new Date().toISOString());
    const input: TaskInput = { conceptIds: [concept.conceptId], type: 'cued_recall', intendedDimensions: ['memory_accessibility'], representation: 'text', novelty: 'isomorphic', origin: 'manual', prompt: 'SYNTHETIC STRUCTURAL ACCEPTANCE ONLY: type the token alpha. This does not assess the referenced Logic concept.', scoring: { kind: 'text', expected: 'alpha', normalization: 'exact' }, sourceRefs: concept.sourceRefs.map(({ sourceId, version, segmentId }) => ({ sourceId, version, segmentId })), researchRefs: [] };
    const task = assessments.createTask(courseId, input);
    const response: Submission = { taskId: task.id, response: 'alpha', assistance: 'none', hints: { count: 0, highestLevel: 'none', notes: null }, confidence: 0.9 };
    const attempt = assessments.submit(courseId, 'synthetic-independent', response);
    assert.deepEqual(assessments.submit(courseId, 'synthetic-independent', response), attempt);
    assert.throws(() => assessments.submit(courseId, 'synthetic-independent', { ...response, response: 'beta' }));
    const independent = await evaluations.evaluate(courseId, attempt.id, 'synthetic-deterministic', new DeterministicEvaluator());
    assert.ok(independent.evidence);
    const assisted = assessments.submit(courseId, 'synthetic-guided', { ...response, assistance: 'guided', hints: { count: 1, highestLevel: 'guided', notes: 'SYNTHETIC assistance fixture, not a real interaction.' } });
    const failed = await evaluations.evaluate(courseId, assisted.id, 'synthetic-failure', { identity: { kind: 'human', name: 'synthetic-failure-fixture', version: '1', policyVersion: 'fixture-v1' }, evaluate: async () => { throw new Error('Synthetic failure'); } });
    assert.equal(failed.evidence, null);
    assert.equal(failed.evaluation.status, 'failed');
    assert.deepEqual(assessments.attempt(courseId, assisted.id), assisted);
    const retry = await evaluations.evaluate(courseId, assisted.id, 'synthetic-retry', new DeterministicEvaluator(), failed.evaluation.id);
    assert.ok(retry.evidence);
    const correction = evaluations.record(courseId, attempt.id, 'synthetic-correction', { kind: 'human', name: 'synthetic-correction-fixture', version: '1', policyVersion: 'fixture-v1' }, { status: 'scored', correctness: 0, rubricScores: {}, rationale: 'SYNTHETIC lineage demonstration: deliberately revised fixture grade, not a real assessment judgement.' }, independent.evaluation.id);
    assert.ok(correction.evidence);
    assert.equal(evaluations.list(courseId, attempt.id).length, 2);
    store.graphs.activate(courseId, 2, new Date().toISOString());
    const audit = evidence.show(courseId, independent.evidence.id);
    assert.equal(audit.task.curriculumVersion, 1);
    assert.equal(audit.attempt.assistance, 'none');
    assert.equal(evidence.show(courseId, retry.evidence.id).attempt.assistance, 'guided');
    const history = evidence.recent(courseId);
    store.close();
    store = openLearningDatabase(run);
    assert.deepEqual(store.assessments.recent(courseId, 20), history);
    assert.deepEqual(store.assessments.attemptOperation(courseId, 'synthetic-independent'), attempt);
    assert.equal(store.graphs.current(courseId), 2);
    assert.equal(digest(original), before);
    const report = { label: 'ALL PERFORMANCE DATA IS SYNTHETIC; real Logic linkage is structural only.', courseId, conceptId: concept.conceptId, taskId: task.id, attemptId: attempt.id, evidenceId: independent.evidence.id, curriculumVersion: 1, activeVersion: 2, sourceRefs: task.sourceRefs, originalDatabaseUnchanged: true, restartPreservedHistory: true, idempotencyPassed: true, assistanceDistinct: true, failedEvaluationNoEvidence: true, laterRetryPassed: true, correctionPreservedHistory: true, schemaVersion: store.readStatus().schemaVersion };
    writeFileSync(join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ run, ...report }, null, 2));
}
finally {
    store.close();
}
