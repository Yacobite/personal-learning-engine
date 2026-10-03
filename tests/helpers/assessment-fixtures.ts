import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '../../src/persistence/migrations.ts';
import { SqliteFoundationStore } from '../../src/persistence/database.ts';
import { CourseService } from '../../src/services/course-service.ts';
import { GraphService } from '../../src/services/graph-service.ts';
import { AssessmentService } from '../../src/services/assessment-service.ts';
import { EvaluationService } from '../../src/services/evaluation-service.ts';
import { EvidenceService } from '../../src/services/evidence-service.ts';
import type { TaskInput, Submission, EvaluationProposal } from '../../src/domain/assessment.ts';
import { course, sourceId, sourceVersion, proposal, now } from './graph-fixtures.ts';
export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export const ids = (prefix: string) => `${prefix}-${randomUUID()}`;
export const human = { kind: 'human' as const, name: 'synthetic-reviewer', version: '1', policyVersion: 'synthetic-review-v1' };
export const correct: EvaluationProposal = { status: 'scored', correctness: 1, rubricScores: {}, rationale: 'Synthetic comparison; no mastery inference.' };
export function services(store: SqliteFoundationStore) {
    const courses = new CourseService(store.courses, () => ids('course'), () => new Date(now));
    const graphs = new GraphService(courses, store.graphs, store.sources, store.research, () => ids('concept'), () => new Date(now));
    const assessments = new AssessmentService(courses, store.assessments, store.graphs, store.sources, store.research, ids, hash, () => new Date(now));
    const evaluations = new EvaluationService(assessments, store.assessments, ids, hash, () => new Date(now));
    const evidence = new EvidenceService(courses, store.assessments, store.graphs);
    return { courses, graphs, assessments, evaluations, evidence };
}
export function fixture(path = ':memory:') {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys=ON');
    applyMigrations(db);
    const store = new SqliteFoundationStore(db);
    store.courses.create(course);
    store.sources.save({ proposedId: sourceId, courseId: course.id, identityKey: 'synthetic.md', kind: 'text', origin: 'learner_file', location: 'synthetic.md', ingestedAt: now, contentHash: sourceVersion.contentHash, document: sourceVersion });
    const runtime = services(store);
    const graph = runtime.graphs.createDraft(course.id, proposal());
    runtime.graphs.activate(course.id, graph.version);
    return { db, store, ...runtime, courseId: course.id, graph };
}
export function taskInput(conceptId: string): TaskInput { return { conceptIds: [conceptId], type: 'cued_recall', intendedDimensions: ['memory_accessibility'], representation: 'text', novelty: 'isomorphic', origin: 'manual', prompt: 'SYNTHETIC DEVELOPMENT TASK: type the token alpha.', scoring: { kind: 'text', expected: 'alpha', normalization: 'exact' }, sourceRefs: [], researchRefs: [] }; }
export function submission(taskId: string): Submission { return { taskId, response: 'alpha', assistance: 'none', hints: { count: 0, highestLevel: 'none', notes: null } }; }
