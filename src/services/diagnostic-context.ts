import { DiagnosticError } from '../domain/diagnostic.ts';
import { validateTask, canonical } from '../domain/assessment-validation.ts';
import type { TaskInput } from '../domain/assessment.ts';
import type { CurriculumVersion } from '../domain/curriculum.ts';
import type { DiagnosticTaskContext } from '../ports/diagnostic-generator.ts';
import type { SourceRepository } from '../ports/source-repository.ts';
import type { ResearchRepository } from '../ports/research.ts';
export class DiagnosticContextBuilder {
    private readonly sources: Pick<SourceRepository, 'getVersion'>;
    private readonly research: Pick<ResearchRepository, 'get'>;
    constructor(sources: Pick<SourceRepository, 'getVersion'>, research: Pick<ResearchRepository, 'get'>) { this.sources = sources; this.research = research; }
    build(graph: CurriculumVersion, conceptId: string, sequence: number): DiagnosticTaskContext {
        const context = this.tryBuild(graph, conceptId, sequence);
        if (!context)
            throw new DiagnosticError('Selected concept has no usable grounded context.');
        return context;
    }
    /** Only unavailable grounded evidence returns undefined; lookup/configuration errors propagate. */
    tryBuild(graph: CurriculumVersion, conceptId: string, sequence: number): DiagnosticTaskContext | undefined {
        const node = graph.nodes.find(n => n.conceptId === conceptId);
        if (!node)
            throw new DiagnosticError('Selected concept is absent from the pinned curriculum.');
        const types = ['cued_recall', 'discrimination', 'prediction'] as const;
        const type = node.type === 'procedure' ? 'procedure' : types[(sequence - 1) % types.length]!;
        const context: DiagnosticTaskContext = { courseId: graph.courseId, curriculumVersion: graph.version, conceptId, type,
            representation: type === 'cued_recall' ? 'text' : 'mixed', novelty: 'isomorphic', title: node.title.slice(0, 500), nodeType: node.type, summary: node.summary.slice(0, 2500),
            prerequisites: graph.edges.filter(e => e.type === 'prerequisite_of' && e.to === conceptId).slice(0, 20).map(e => ({ conceptId: e.from, title: graph.nodes.find(n => n.conceptId === e.from)!.title.slice(0, 500) })), source: [], research: [] };
        for (const ref of node.sourceRefs) {
            const version = this.sources.getVersion(graph.courseId, ref.sourceId, ref.version);
            const segment = version?.segments.find(s => `${ref.sourceId}@${ref.version}:${s.order}` === ref.segmentId);
            if (version && ['ready', 'ready_with_warnings', 'extraction_incomplete'].includes(version.status) && segment?.text.trim())
                context.source.push({ ref: { sourceId: ref.sourceId, version: ref.version, segmentId: ref.segmentId }, text: segment.text.slice(0, 1800), anchor: segment.anchor, warnings: version.warnings.slice(0, 10).map(w => w.code) });
            if (context.source.length === 6)
                break;
        }
        // Source context takes priority in hybrid graphs. No new research retrieval.
        if (!context.source.length)
            for (const ref of node.researchRefs) {
                const reference = this.research.get(graph.courseId, ref.briefId)?.references.find(r => r.id === ref.referenceId);
                if (reference?.status === 'ready' && reference.contentHash && reference.text.trim())
                    context.research.push({ ref, text: reference.text.slice(0, 1800), url: reference.url });
                if (context.research.length === 4)
                    break;
            }
        if (!context.source.length && !context.research.length)
            return undefined;
        return context;
    }
}
/** Strict proposal boundary: the model supplies content, never selection or identity. */
export function diagnosticTask(context: DiagnosticTaskContext, value: unknown): TaskInput {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        throw new DiagnosticError('Expected a plain task proposal.');
    const object = value as Record<string, unknown>;
    if (Reflect.ownKeys(object).length !== 4 || Reflect.ownKeys(object).some(k => typeof k !== 'string' || !['prompt', 'scoring', 'sourceRefs', 'researchRefs'].includes(k)))
        throw new DiagnosticError('Task proposal must contain only prompt, scoring, sourceRefs and researchRefs.');
    const input = validateTask({ ...object, curriculumVersion: context.curriculumVersion, conceptIds: [context.conceptId], type: context.type,
        intendedDimensions: [context.type === 'discrimination' ? 'discrimination' : context.type === 'procedure' ? 'procedural_fluency' : context.type === 'prediction' ? 'application' : 'memory_accessibility'],
        representation: context.representation, novelty: context.novelty, origin: context.source.length ? 'source_derived' : 'curriculum_generated' });
    if (input.scoring.kind === 'open')
        throw new DiagnosticError('M5 requires deterministically gradable tasks.');
    if (/\b(?:answer\s*key|correct\s*answer)\s*:/i.test(input.prompt))
        throw new DiagnosticError('Prompt contains an answer-key marker.');
    const allowedSource = new Set(context.source.map(s => canonical(s.ref)));
    const allowedResearch = new Set(context.research.map(r => canonical(r.ref)));
    if (input.sourceRefs.some(r => !allowedSource.has(canonical(r))) || input.researchRefs.some(r => !allowedResearch.has(canonical(r)))
        || (!input.sourceRefs.length && !input.researchRefs.length))
        throw new DiagnosticError('Proposal provenance must use the supplied grounded context.');
    return input;
}
export function publicDiagnosticTask(task: TaskInput & {
    id: string;
}) {
    return { id: task.id, prompt: task.prompt, type: task.type, representation: task.representation,
        ...(task.scoring.kind === 'choice' ? { options: task.scoring.options } : {}),
        ...(task.scoring.kind === 'set' ? { responseFormat: 'JSON array of strings' } : {}) };
}
