import { DiagnosticContextBuilder } from './diagnostic-context.ts';
import type { SourceRepository } from '../ports/source-repository.ts';
import type { ResearchRepository } from '../ports/research.ts';
import type { CurriculumVersion } from '../domain/curriculum.ts';
/** Select a bounded verbatim window, without changing provenance or retrieving new material. */
export function teachingExcerpt(text: string, title: string): string {
    const words = title.replace(/\(revised presentation\)/gi, '').toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const terms = words.filter(w => !['with', 'from', 'and', 'the'].includes(w)).map(w => w.endsWith('s') ? w.slice(0, -1) : w);
    const positions = terms.map(w => text.toLowerCase().indexOf(w)).filter(i => i >= 0);
    const match = positions.length ? Math.min(...positions) : 0;
    const paragraph = text.lastIndexOf('\n\n', match);
    const start = paragraph >= Math.max(0, match - 400) ? paragraph : Math.max(0, match - 250);
    return text.slice(start, start + 1800).trim();
}
export class TeachingContextBuilder extends DiagnosticContextBuilder {
    private readonly sourceStore: Pick<SourceRepository, 'getVersion'>;
    private readonly researchStore: Pick<ResearchRepository, 'get'>;
    constructor(sources: Pick<SourceRepository, 'getVersion'>, research: Pick<ResearchRepository, 'get'>) {
        super(sources, research);
        this.sourceStore = sources;
        this.researchStore = research;
    }
    override tryBuild(graph: CurriculumVersion, conceptId: string, sequence: number) {
        const context = super.tryBuild(graph, conceptId, sequence);
        if (!context) return undefined;
        for (const source of context.source) {
            const version = this.sourceStore.getVersion(graph.courseId, source.ref.sourceId, source.ref.version)!;
            const segment = version.segments.find(s => source.ref.segmentId === source.ref.sourceId + '@' + source.ref.version + ':' + s.order)!;
            source.text = teachingExcerpt(segment.text, context.title);
        }
        for (const reference of context.research) {
            const stored = this.researchStore.get(graph.courseId, reference.ref.briefId)!.references.find(r => r.id === reference.ref.referenceId)!;
            reference.text = teachingExcerpt(stored.text, context.title);
        }
        return context;
    }
}
