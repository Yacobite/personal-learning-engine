import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssessmentTask, Attempt, EvaluationWrite } from '../src/domain/assessment.ts';
import type { AssessmentRepository } from '../src/ports/assessment-repository.ts';
import { AssessmentService } from '../src/services/assessment-service.ts';
import { EvaluationService } from '../src/services/evaluation-service.ts';
import { MemoryGraphs, course, now } from './helpers/graph-fixtures.ts';
import { ids, hash, taskInput, submission, human, correct } from './helpers/assessment-fixtures.ts';
test('assessment/evaluation services operate through fake ports without Pi or a database', async () => {
    const concept = ids('concept');
    const graphs = new MemoryGraphs();
    graphs.saveDraft({ courseId: course.id, createdAt: now, rationale: 'Synthetic', uncertainty: [], edges: [], nodes: [{ conceptId: concept, title: 'Synthetic', type: 'concept', summary: 'Synthetic', sourceRefs: [], researchRefs: [] }] }, [{ id: concept, courseId: course.id, createdAt: now }]);
    graphs.activate(course.id, 1, now);
    const tasks = new Map<string, AssessmentTask>();
    const attempts = new Map<string, Attempt>();
    const writes: EvaluationWrite[] = [];
    const repo: AssessmentRepository = {
        saveTask: (task) => { tasks.set(task.id, structuredClone(task)); }, task: (courseId, id) => tasks.get(id)?.courseId === courseId ? structuredClone(tasks.get(id)!) : undefined,
        saveAttempt: (a) => { attempts.set(a.id, structuredClone(a)); return structuredClone(a); }, attempt: (courseId, id) => attempts.get(id)?.courseId === courseId ? structuredClone(attempts.get(id)!) : undefined,
        attemptOperation: (courseId, key) => [...attempts.values()].find((a) => a.courseId === courseId && a.operationId === key),
        saveEvaluation: (w) => { writes.push(structuredClone(w)); return structuredClone(w); }, evaluation: (courseId, id) => writes.find((w) => w.evaluation.courseId === courseId && w.evaluation.id === id)?.evaluation,
        evaluationOperation: (courseId, key) => writes.find((w) => w.evaluation.courseId === courseId && w.evaluation.operationId === key),
        evaluations: (courseId, id) => writes.filter((w) => w.evaluation.courseId === courseId && w.evaluation.attemptId === id).map((w) => w.evaluation), evidence: () => undefined, recent: () => [],
    };
    const assessments = new AssessmentService({ getCourse: (id) => { assert.equal(id, course.id); return course; } }, repo, graphs, { getVersion: () => undefined }, { get: () => undefined }, ids, hash, () => new Date(now));
    const input = taskInput(concept);
    const task = assessments.createTask(course.id, input);
    const actual = assessments.submit(course.id, 'submit', submission(task.id));
    const evaluations = new EvaluationService(assessments, repo, ids, hash, () => new Date(now));
    const result = await evaluations.evaluate(course.id, actual.id, 'eval', { identity: human, evaluate: async (context) => {
            assert.equal(context.attempt.response, 'alpha');
            assert.equal(context.task.curriculumVersion, 1);
            // A hostile evaluator can mutate only its detached input, never stored identity.
            (context.task.conceptIds as string[])[0] = ids('concept');
            return correct;
        } });
    assert.equal(result.evidence!.attemptId, actual.id);
    assert.equal(assessments.task(course.id, task.id).conceptIds[0], concept);
    assert.deepEqual(assessments.submit(course.id, 'submit', submission(task.id)), actual);
    assert.equal(attempts.size, 1);
    assert.deepEqual(evaluations.record(course.id, actual.id, 'manual', human, correct).evaluation.evaluator, human);
});
