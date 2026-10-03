import { GraphError, isConceptId, prerequisiteOrder, requireVersion } from '../domain/curriculum.ts';
import type { Concept, CurriculumVersion } from '../domain/curriculum.ts';
import { validateProposal } from '../domain/proposal-validation.ts';
import type { GraphRepository } from '../ports/graph-repository.ts';
import type { SourceRepository } from '../ports/source-repository.ts';
import type { ResearchRepository } from '../ports/research.ts';
import type { CourseService } from './course-service.ts';
export class GraphService {
    private readonly courses: Pick<CourseService, 'getCourse'>;
    private readonly repository: GraphRepository;
    private readonly sources: Pick<SourceRepository, 'getVersion'>;
    private readonly research: Pick<ResearchRepository, 'get'>;
    private readonly id: () => string;
    private readonly clock: () => Date;
    constructor(courses: Pick<CourseService, 'getCourse'>, repository: GraphRepository, sources: Pick<SourceRepository, 'getVersion'>, research: Pick<ResearchRepository, 'get'>, id: () => string, clock: () => Date) {
        this.courses = courses;
        this.repository = repository;
        this.sources = sources;
        this.research = research;
        this.id = id;
        this.clock = clock;
    }
    createDraft(courseId: string, value: unknown): CurriculumVersion {
        const course = this.courses.getCourse(courseId);
        const proposal = validateProposal(value);
        const createdAt = this.clock().toISOString();
        const newConcepts: Concept[] = [];
        const mapping = new Map<string, string>();
        const allocated = new Set<string>();
        const nodes = proposal.nodes.map((node) => {
            if (course.mode === 'source_grounded' && (!node.sourceRefs.length || node.researchRefs.length))
                throw new GraphError('Source-grounded nodes require learner-source provenance only.');
            if (course.mode === 'generated_curriculum' && (!node.researchRefs.length || node.sourceRefs.length))
                throw new GraphError('Generated nodes require research provenance only.');
            let conceptId = node.conceptId;
            if (conceptId) {
                if (!this.repository.concept(courseId, conceptId))
                    throw new GraphError('Reused concept does not belong to this course.');
            }
            else {
                conceptId = this.id();
                if (!isConceptId(conceptId) || this.repository.concept(courseId, conceptId))
                    throw new GraphError('Invalid or colliding generated concept ID.');
                newConcepts.push({ id: conceptId, courseId, createdAt });
            }
            if (allocated.has(conceptId))
                throw new GraphError('Duplicate concept identity.');
            allocated.add(conceptId);
            mapping.set(node.key, conceptId);
            const sourceRefs = node.sourceRefs.map((ref) => {
                const version = this.sources.getVersion(courseId, ref.sourceId, ref.version);
                const segment = version?.segments.find((part) => `${ref.sourceId}@${ref.version}:${part.order}` === ref.segmentId);
                if (!segment || !segment.text.trim() || !version || !['ready', 'ready_with_warnings', 'extraction_incomplete'].includes(version.status))
                    throw new GraphError('Source/version/segment provenance is missing or unusable in this course.');
                return { ...ref, anchor: segment.anchor };
            });
            for (const ref of node.researchRefs) {
                const reference = this.research.get(courseId, ref.briefId)?.references.find((item) => item.id === ref.referenceId);
                if (!reference || reference.status !== 'ready' || !reference.contentHash || !reference.text.trim())
                    throw new GraphError('Research provenance must reference a successfully retrieved item in this course.');
            }
            return { conceptId, title: node.title, type: node.type, summary: node.summary, sourceRefs, researchRefs: node.researchRefs };
        });
        return this.storage(() => this.repository.saveDraft({ courseId, createdAt, nodes,
            edges: proposal.edges.map((edge) => ({ ...edge, from: mapping.get(edge.from)!, to: mapping.get(edge.to)! })),
            rationale: proposal.rationale, uncertainty: proposal.uncertainty }, newConcepts));
    }
    list(courseId: string): CurriculumVersion[] { this.courses.getCourse(courseId); return this.storage(() => this.repository.list(courseId)); }
    current(courseId: string): number | undefined { this.courses.getCourse(courseId); return this.storage(() => this.repository.current(courseId)); }
    get(courseId: string, version?: number): CurriculumVersion {
        this.courses.getCourse(courseId);
        const selected = version ?? this.current(courseId);
        if (selected === undefined)
            throw new GraphError('No active curriculum. Inspect a draft by version.');
        requireVersion(selected);
        const graph = this.storage(() => this.repository.get(courseId, selected));
        if (!graph)
            throw new GraphError('Curriculum version not found in this course.');
        return graph;
    }
    validate(courseId: string, version?: number): string[] {
        const graph = this.get(courseId, version);
        return prerequisiteOrder(graph.nodes.map((node) => node.conceptId), graph.edges);
    }
    activate(courseId: string, version: number): void {
        this.validate(courseId, version);
        this.storage(() => this.repository.activate(courseId, version, this.clock().toISOString()));
    }
    inspect(courseId: string, conceptId: string, version?: number) {
        if (!isConceptId(conceptId))
            throw new GraphError('Expected concept-<UUID v4>.');
        const graph = this.get(courseId, version);
        const node = graph.nodes.find((item) => item.conceptId === conceptId);
        if (!node)
            throw new GraphError('Concept not found in this curriculum.');
        return { node, incoming: graph.edges.filter((edge) => edge.to === conceptId), outgoing: graph.edges.filter((edge) => edge.from === conceptId),
            researchReferences: node.researchRefs.map((ref) => this.research.get(courseId, ref.briefId)!.references.find((item) => item.id === ref.referenceId)!),
            prerequisites: graph.edges.filter((edge) => edge.type === 'prerequisite_of' && edge.to === conceptId).map((edge) => edge.from),
            dependents: graph.edges.filter((edge) => edge.type === 'prerequisite_of' && edge.from === conceptId).map((edge) => edge.to) };
    }
    private storage<T>(run: () => T): T {
        try {
            return run();
        }
        catch (cause) {
            throw new GraphError('Curriculum storage operation failed; previous state was preserved.', { cause });
        }
    }
}
