import { AssessmentError, isAssessmentId } from '../domain/assessment.ts';
import { isConceptId } from '../domain/curriculum.ts';
import type { AssessmentRepository } from '../ports/assessment-repository.ts';
import type { GraphRepository } from '../ports/graph-repository.ts';
import type { CourseService } from './course-service.ts';
export class EvidenceService {
    private readonly courses: Pick<CourseService, 'getCourse'>;
    private readonly repo: Pick<AssessmentRepository, 'evidence' | 'recent'>;
    private readonly graphs: Pick<GraphRepository, 'concept'>;
    constructor(courses: Pick<CourseService, 'getCourse'>, repo: Pick<AssessmentRepository, 'evidence' | 'recent'>, graphs: Pick<GraphRepository, 'concept'>) { this.courses = courses; this.repo = repo; this.graphs = graphs; }
    show(courseId: string, id: string) { this.courses.getCourse(courseId); if (!isAssessmentId(id, 'evidence'))
        throw new AssessmentError('Invalid evidence ID.'); const result = this.repo.evidence(courseId, id); if (!result)
        throw new AssessmentError('Evidence not found in this course.'); return result; }
    recent(courseId: string, limit = 20) { this.courses.getCourse(courseId); this.limit(limit); return this.repo.recent(courseId, limit); }
    concept(courseId: string, id: string, limit = 20) { this.courses.getCourse(courseId); this.limit(limit); if (!isConceptId(id) || !this.graphs.concept(courseId, id))
        throw new AssessmentError('Concept not found in this course.'); return this.repo.recent(courseId, limit, id); }
    private limit(value: number) { if (!Number.isSafeInteger(value) || value < 1 || value > 100)
        throw new AssessmentError('Audit limit must be 1–100.'); }
}
