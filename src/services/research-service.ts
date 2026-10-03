import { GraphError } from '../domain/curriculum.ts';
import { isResearchId } from '../domain/proposal-validation.ts';
import type { OfficialResearcher, ResearchRepository } from '../ports/research.ts';
import type { CourseService } from './course-service.ts';
export class ResearchService {
    private readonly courses: Pick<CourseService, 'getCourse'>;
    private readonly repository: ResearchRepository;
    private readonly researcher: OfficialResearcher;
    constructor(courses: Pick<CourseService, 'getCourse'>, repository: ResearchRepository, researcher: OfficialResearcher) {
        this.courses = courses;
        this.repository = repository;
        this.researcher = researcher;
    }
    async retrieve(courseId: string) {
        const course = this.courses.getCourse(courseId);
        if (course.mode === 'source_grounded')
            throw new GraphError('Official Python research is for generated or hybrid courses.');
        const brief = await this.researcher.retrieve(courseId, course.objective);
        if (brief.courseId !== courseId || brief.goal !== course.objective || !isResearchId(brief.id, 'brief') || !brief.references.length || brief.references.length > 6
            || !Number.isFinite(Date.parse(brief.createdAt)))
            throw new GraphError('Invalid trusted research result.');
        const ids = new Set<string>();
        for (const ref of brief.references) {
            if (!isResearchId(ref.id,'reference') || ids.has(ref.id) || ref.publisher !== 'Python Software Foundation'
                || ref.authority !== 'official_documentation' || !Number.isFinite(Date.parse(ref.retrievedAt))
                || !/^https:\/\/docs\.python\.org\/3\/tutorial\/(introduction|controlflow|datastructures|modules|inputoutput|errors)\.html$/.test(ref.url)
                || (ref.status === 'ready' ? !ref.contentHash || !/^[a-f0-9]{64}$/.test(ref.contentHash) || !ref.text.trim() || ref.text.length>250000
                    : ref.status !== 'failed' || ref.contentHash !== null || ref.text !== '' || ref.title !== null)) throw new GraphError('Invalid trusted research reference metadata.');
            ids.add(ref.id);
        }
        this.repository.save(brief);
        return brief;
    }
    get(courseId: string, id: string) {
        this.courses.getCourse(courseId);
        if (!isResearchId(id, 'brief'))
            throw new GraphError('Invalid research brief ID.');
        const brief = this.repository.get(courseId, id);
        if (!brief)
            throw new GraphError('Research brief not found in this course.');
        return brief;
    }
    list(courseId: string) { this.courses.getCourse(courseId); return this.repository.list(courseId); }
}
