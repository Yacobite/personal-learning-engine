import { fixture, ids, hash, human } from './assessment-fixtures.ts';
import { AssessmentService } from '../../src/services/assessment-service.ts';
import { EvaluationService } from '../../src/services/evaluation-service.ts';
import { LearnerStateService } from '../../src/services/learner-state-service.ts';
import { ReadinessService } from '../../src/services/readiness-service.ts';
import { GapService } from '../../src/services/gap-service.ts';
import type { Dimension } from '../../src/domain/learner-state.ts';
import type { AssessmentTask, Submission, EvaluationProposal } from '../../src/domain/assessment.ts';
export const startTime = '2026-10-04T00:00:00.000Z';
export function learnerFixture(path = ':memory:') {
    const f = fixture(path);
    let time = Date.parse(startTime), sequence = 0;
    const clock = () => new Date(time);
    const assessments = new AssessmentService(f.courses, f.store.assessments, f.store.graphs, f.store.sources, f.store.research, ids, hash, clock);
    const evaluations = new EvaluationService(assessments, f.store.assessments, ids, hash, clock);
    const state = new LearnerStateService(f.store.learnerState, f.store.learnerLedger, f.graphs, ids, hash, clock);
    const root = f.graph.edges.find(e => e.type === 'prerequisite_of')!.from;
    const child = f.graph.edges.find(e => e.type === 'prerequisite_of')!.to;
    function add(options: {
        conceptId?: string;
        conceptIds?: string[];
        dimensions?: Dimension[];
        correctness?: number;
        status?: EvaluationProposal['status'];
        assistance?: Submission['assistance'];
        novelty?: AssessmentTask['novelty'];
        representation?: AssessmentTask['representation'];
        confidence?: number;
        taskId?: string;
        prompt?: string;
        at?: string;
        curriculumVersion?: number;
    } = {}) {
        if (options.at)
            time = Date.parse(options.at);
        else
            time += 1000;
        sequence++;
        const dims = options.dimensions ?? ['memory_accessibility'];
        const task = options.taskId ? assessments.task(f.courseId, options.taskId) : assessments.createTask(f.courseId, {
            ...(options.curriculumVersion === undefined ? {} : { curriculumVersion: options.curriculumVersion }), conceptIds: options.conceptIds ?? [options.conceptId ?? root],
            type: dims.includes('transfer') ? 'near_transfer' : dims.includes('structural_understanding') ? 'self_explanation' : dims.includes('representation_flexibility') ? 'representation_conversion' : 'cued_recall',
            intendedDimensions: dims, representation: options.representation ?? 'text', novelty: options.novelty ?? 'isomorphic', origin: 'manual',
            prompt: options.prompt ?? ('SYNTHETIC DEVELOPMENT POLICY FIXTURE ' + sequence + '; not an assessment of course knowledge.'),
            scoring: { kind: 'open', rubricVersion: 'synthetic-state-v1', criteria: [{ key: 'synthetic', description: 'Explicit synthetic evaluator outcome for learner-state policy validation.' }], expected: null }, sourceRefs: [], researchRefs: []
        });
        const assistance = options.assistance ?? 'none';
        const attempt = assessments.submit(f.courseId, 'synthetic-state:attempt:' + sequence, { taskId: task.id, response: 'SYNTHETIC_RESPONSE_SENTINEL_NOT_COPIED_TO_STATE', assistance, hints: { count: assistance === 'none' || assistance === 'ai_performed' ? 0 : 1, highestLevel: assistance === 'ai_performed' ? 'none' : assistance, notes: null }, ...(options.confidence === undefined ? {} : { confidence: options.confidence }) });
        const status = options.status ?? 'scored', correctness = status === 'scored' ? (options.correctness ?? 1) : null;
        const write = evaluations.record(f.courseId, attempt.id, 'synthetic-state:evaluation:' + sequence, human, { status, correctness, rubricScores: correctness !== null && correctness > 0 && correctness < 1 ? { synthetic: correctness } : {}, rationale: 'ALL PERFORMANCE DATA IS SYNTHETIC DEVELOPMENT DATA.' });
        return { task, attempt, ...write };
    }
    return { ...f, assessments, evaluations, state, readiness: new ReadinessService(state), gaps: new GapService(state), clock, root, child, add, set: (at: string) => { time = Date.parse(at); }, tick: (ms: number) => { time += ms; }, read: () => state.refresh(f.courseId) };
}
