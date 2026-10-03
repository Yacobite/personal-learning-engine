import { AssessmentError, isAssessmentId } from '../domain/assessment.ts';
import type { AssessmentTask, Attempt } from '../domain/assessment.ts';
import { canonical, operationId, validateTask, validateSubmission } from '../domain/assessment-validation.ts';
import type { AssessmentRepository } from '../ports/assessment-repository.ts';
import type { GraphRepository } from '../ports/graph-repository.ts';
import type { SourceRepository } from '../ports/source-repository.ts';
import type { ResearchRepository } from '../ports/research.ts';
import type { CourseService } from './course-service.ts';
export class AssessmentService {
    private readonly courses: Pick<CourseService, 'getCourse'>;
    private readonly repo: AssessmentRepository;
    private readonly graphs: GraphRepository;
    private readonly sources: Pick<SourceRepository, 'getVersion'>;
    private readonly research: Pick<ResearchRepository, 'get'>;
    private readonly id: (prefix: 'task' | 'attempt') => string;
    private readonly hash: (value: string) => string;
    private readonly clock: () => Date;
    constructor(courses: Pick<CourseService, 'getCourse'>, repo: AssessmentRepository, graphs: GraphRepository, sources: Pick<SourceRepository, 'getVersion'>, research: Pick<ResearchRepository, 'get'>, id: (prefix: 'task' | 'attempt') => string, hash: (value: string) => string, clock: () => Date) {
        this.courses = courses;
        this.repo = repo;
        this.graphs = graphs;
        this.sources = sources;
        this.research = research;
        this.id = id;
        this.hash = hash;
        this.clock = clock;
    }
    createTask(courseId: string, value: unknown): AssessmentTask {
        this.courses.getCourse(courseId);
        const input = validateTask(value);
        const version = input.curriculumVersion ?? this.graphs.current(courseId);
        const graph = version === undefined ? undefined : this.graphs.get(courseId, version);
        if (!graph)
            throw new AssessmentError('Task requires an existing curriculum version (or an active curriculum).');
        for (const id of input.conceptIds)
            if (!this.graphs.concept(courseId, id) || !graph.nodes.some((n) => n.conceptId === id))
                throw new AssessmentError('Task concept is absent from this course/curriculum version.');
        for (const ref of input.sourceRefs) {
            const source = this.sources.getVersion(courseId, ref.sourceId, ref.version);
            if (!source || !['ready', 'ready_with_warnings', 'extraction_incomplete'].includes(source.status) || !source.segments.some((p) => `${ref.sourceId}@${ref.version}:${p.order}` === ref.segmentId && p.text.trim()))
                throw new AssessmentError('Task source provenance is absent or unusable in this course.');
        }
        for (const ref of input.researchRefs)
            if (!this.research.get(courseId, ref.briefId)?.references.some((r) => r.id === ref.referenceId && r.status === 'ready' && r.contentHash && r.text.trim()))
                throw new AssessmentError('Task research provenance is absent or unusable in this course.');
        const id = this.id('task');
        if (!isAssessmentId(id, 'task'))
            throw new AssessmentError('Invalid generated task ID.');
        const task = { ...input, id, courseId, curriculumVersion: graph.version, createdAt: this.clock().toISOString() };
        this.repo.saveTask(task);
        return this.repo.task(courseId, id)!;
    }
    submit(courseId: string, key: string, value: unknown): Attempt {
        this.courses.getCourse(courseId);
        operationId(key);
        const input = validateSubmission(value);
        const requestHash = this.hash(canonical(input));
        if (!/^[a-f0-9]{64}$/.test(requestHash))
            throw new AssessmentError('Hasher must return SHA-256.');
        const existing = this.repo.attemptOperation(courseId, key);
        if (existing) {
            if (existing.requestHash !== requestHash)
                throw new AssessmentError('Attempt operation ID conflicts with its original payload.');
            return existing;
        }
        const task = this.task(courseId, input.taskId);
        const id = this.id('attempt');
        if (!isAssessmentId(id, 'attempt'))
            throw new AssessmentError('Invalid generated attempt ID.');
        return this.repo.saveAttempt({ ...input, id, courseId, curriculumVersion: task.curriculumVersion, conceptIds: task.conceptIds,
            novelty: task.novelty, representation: task.representation, operationId: key, requestHash, submittedAt: this.clock().toISOString() });
    }
    task(courseId: string, id: string): AssessmentTask {
        this.courses.getCourse(courseId);
        if (!isAssessmentId(id, 'task'))
            throw new AssessmentError('Invalid task ID.');
        const task = this.repo.task(courseId, id);
        if (!task)
            throw new AssessmentError('Task not found in this course.');
        return task;
    }
    attempt(courseId: string, id: string): Attempt {
        this.courses.getCourse(courseId);
        if (!isAssessmentId(id, 'attempt'))
            throw new AssessmentError('Invalid attempt ID.');
        const attempt = this.repo.attempt(courseId, id);
        if (!attempt)
            throw new AssessmentError('Attempt not found in this course.');
        return attempt;
    }
}
